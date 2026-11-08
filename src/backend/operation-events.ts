import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { AutomationDefinition } from "../types.js";
import type { Deps } from "./deps.js";
import type { AutomationEngine } from "./engine.js";
import type { AutomationRepository } from "./repository.js";

interface EventLike {
  eventId: string;
  pluginId: string;
  hostId?: number;
  payload?: unknown;
  depth: number;
}

function matches(pattern: string, eventId: string): boolean {
  if (pattern === "*" || pattern === eventId) return true;
  return pattern.endsWith(".*") && eventId.startsWith(pattern.slice(0, -1));
}

/**
 * Runs automations whose trigger is a declared event, such as a firewall
 * being turned off or an action failing. The owner must still reach the host
 * the event is about. Events with no host go only to admins.
 */
export function watchOperationEvents(
  ctx: PluginContext,
  repository: AutomationRepository,
  engine: AutomationEngine,
  isMaintaining: (userId: string, hostId: number) => Promise<boolean>,
  deps?: Pick<Deps, "fleets">,
): void {
  if (typeof ctx.operations?.onEvent !== "function") return;

  const allowed = async (userId: string, hostId?: number) =>
    ctx.asUser(userId, async () =>
      hostId === undefined
        ? ctx.rbac.has("admin.plugins.manage")
        : (await ctx.hosts.checkAccess(hostId, "connect")).hasAccess,
    );

  // A fleet trigger only fires for its members, read as the owner.
  const inFleet = async (userId: string, fleetId: number, hostId: number) => {
    const fleets = deps?.fleets();
    if (typeof fleets?.members !== "function") return false;
    try {
      const members = await ctx.asUser(userId, () => fleets.members!(fleetId));
      return members.some((member) => member.id === hostId);
    } catch {
      return false;
    }
  };

  const handle = async (event: EventLike) => {
    for (const row of await repository.listAllEnabled()) {
      let definition: AutomationDefinition;
      try {
        definition = JSON.parse(row.definition) as AutomationDefinition;
      } catch {
        continue;
      }
      const trigger = definition.trigger;
      if (trigger?.kind !== "operation_event") continue;
      if (!matches(trigger.event, event.eventId)) continue;
      if (
        event.hostId !== undefined &&
        trigger.hostSelector?.kind === "host" &&
        trigger.hostSelector.hostId !== event.hostId
      ) {
        continue;
      }
      if (
        event.hostId !== undefined &&
        trigger.hostSelector?.kind === "hosts" &&
        !trigger.hostSelector.hostIds.includes(event.hostId)
      ) {
        continue;
      }
      if (
        event.hostId !== undefined &&
        trigger.hostSelector?.kind === "fleet" &&
        !(await inFleet(row.userId, trigger.hostSelector.fleetId, event.hostId))
      ) {
        continue;
      }
      if (!(await allowed(row.userId, event.hostId).catch(() => false))) {
        continue;
      }
      if (
        event.hostId !== undefined &&
        (await isMaintaining(row.userId, event.hostId))
      ) {
        continue;
      }
      const stateKey = `op:${event.eventId}:${event.hostId ?? "global"}`;
      const state = await repository.getTriggerState(row.id, stateKey);
      const cooldown = Math.max(trigger.cooldownMinutes ?? 1, 1) * 60_000;
      if (
        state?.lastFiredAt &&
        Date.now() - Date.parse(state.lastFiredAt) < cooldown
      ) {
        continue;
      }
      await repository.upsertTriggerState({
        automationId: row.id,
        stateKey,
        lastFiredAt: new Date().toISOString(),
      });
      void engine
        .run({
          automationId: row.id,
          triggerType: "operation_event",
          triggerContext: {
            event: event.eventId,
            pluginId: event.pluginId,
            hostId: event.hostId,
            payload: event.payload,
          },
          triggerHostId: event.hostId,
        })
        .catch((error: unknown) =>
          ctx.log.warn(
            `Automation ${row.id} failed to start: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
  };

  ctx.operations.onEvent({
    pattern: "*",
    handler: (event) => {
      // A run an automation started can emit events of its own, so chains stop early.
      if (event.depth > 1) return;
      void handle(event).catch((error: unknown) =>
        ctx.log.warn(
          `Event trigger failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    },
  });
}
