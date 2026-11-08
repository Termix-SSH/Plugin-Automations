import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { AutomationEngine } from "./engine.js";
import type { AutomationRepository } from "./repository.js";

function actor(ctx: PluginContext): string {
  const userId = ctx.currentActor();
  if (!userId) throw new Error("This needs a user");
  return userId;
}

/** Automations as actions, so one can start from anywhere in Termix. */
export function registerOperations(
  ctx: PluginContext,
  repository: AutomationRepository,
  engine: AutomationEngine,
): void {
  if (typeof ctx.operations?.register !== "function") return;

  ctx.operations.register("automations.list", {
    run: async () => {
      const rows = await repository.list(actor(ctx));
      return {
        summary: `${rows.length} automations`,
        data: {
          rows: rows.map((row) => ({
            id: String(row.id),
            name: row.name,
            enabled: row.enabled,
          })),
          options: rows.map((row) => ({
            value: String(row.id),
            label: row.name,
          })),
        },
      };
    },
  });

  ctx.operations.register("automations.run", {
    run: async (input, context) => {
      const userId = actor(ctx);
      const id = Number(input.automation);
      const existing = await repository.findForUser(id, userId);
      if (!existing) throw new Error("Automation not found");
      const outcome = await engine.run({
        automationId: id,
        triggerType: "manual",
        triggerContext: { manual: true, requestedBy: userId },
        dryRun: context.dryRun,
      });
      if (outcome.status !== "success" && outcome.status !== "skipped") {
        throw new Error(outcome.error ?? `The automation ${outcome.status}`);
      }
      return {
        summary: `${existing.name}: ${outcome.status}`,
        changed: !context.dryRun,
        data: { runId: outcome.runId, status: outcome.status },
      };
    },
  });

  ctx.operations.register("automations.failed-runs", {
    run: async () => {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const runs = await repository.listRuns(actor(ctx), { limit: 200 });
      const failed = runs.filter(
        (row) =>
          (row.status === "failed" || row.status === "timeout") &&
          Date.parse(row.started_at) >= since,
      ).length;
      const label = `${failed} failed in 24 h`;
      return {
        summary: label,
        data: { value: failed, status: failed > 0 ? "warn" : "ok", label },
      };
    },
  });
}
