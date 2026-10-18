import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type {
  AutomationDefinition,
  ConcurrencyPolicy,
  RunStatus,
} from "../types.js";
import type { Deps } from "./deps.js";
import type { AutomationEngine } from "./engine.js";
import type { AutomationRepository } from "./repository.js";
import { missingPlugins, parseDefinition } from "./requirements.js";
import { syncSchedule } from "./routes.js";
import { validateDefinition } from "./validate.js";

export interface AutomationSummary {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerKind: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  missingPlugins: string[];
}

/**
 * The "automations.access" service, version 1. Runs as the caller's user,
 * gated on automations.view; create and run also need automations.create and
 * automations.run.
 */
export interface AutomationsAccessV1 {
  list: () => Promise<AutomationSummary[]>;
  get: (
    id: number,
  ) => Promise<
    (AutomationSummary & { definition: AutomationDefinition | null }) | null
  >;
  /**
   * Validates the definition the same way the create route does. Starts
   * disabled unless `enabled` is set, so an automation nobody watched run
   * does not start firing on its own.
   */
  create: (input: {
    name: string;
    description?: string | null;
    definition: unknown;
    enabled?: boolean;
    /** Defaults to "skip". */
    concurrencyPolicy?: ConcurrencyPolicy;
    /** Whole seconds, 30 to 21600. Defaults to DEFAULT_MAX_RUN_SECONDS. */
    maxRunSeconds?: number;
  }) => Promise<{ id: number; name: string }>;
  run: (
    id: number,
    options?: { dryRun?: boolean },
  ) => Promise<{ runId: number | null; status: RunStatus; error?: string }>;
}

const CONCURRENCY_POLICIES: ConcurrencyPolicy[] = ["skip", "queue", "allow"];
/** A run shorter than this can't do much; longer than six hours is a stuck run. */
const MIN_RUN_SECONDS = 30;
const MAX_RUN_SECONDS = 21_600;

export function createAutomationsService(
  ctx: PluginContext,
  repository: AutomationRepository,
  engine: Pick<AutomationEngine, "run">,
  deps: Deps,
): AutomationsAccessV1 {
  const actor = (method: string) => {
    const userId = ctx.currentActor();
    if (!userId) throw new Error(`automations.access.${method} needs an actor`);
    return userId;
  };
  const summarize = (
    row: Awaited<ReturnType<AutomationRepository["list"]>>[number],
  ) => {
    const definition = parseDefinition(row.definition);
    if (definition?.trigger?.kind === "webhook") {
      definition.trigger = { ...definition.trigger, tokenHash: "" };
    }
    return {
      summary: {
        id: row.id,
        name: row.name,
        description: row.description,
        enabled: !!row.enabled,
        triggerKind: definition?.trigger?.kind ?? null,
        lastRunAt: row.last_run_at,
        lastRunStatus: row.last_run_status,
        missingPlugins: missingPlugins(definition, deps),
      },
      definition,
    };
  };

  return {
    list: async () => {
      const rows = await repository.list(actor("list"));
      return rows.map((row) => summarize(row).summary);
    },

    get: async (id) => {
      const row = await repository.findForUser(id, actor("get"));
      if (!row) return null;
      const { summary, definition } = summarize(row);
      return { ...summary, definition };
    },

    create: async (input) => {
      const userId = actor("create");
      if (!(await ctx.rbac.has("create"))) {
        throw new Error('Creating automations needs "automations.create"');
      }
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) throw new Error("Name is required");
      const validated = validateDefinition(input.definition);
      if (!validated.ok || !validated.definition) {
        throw new Error(
          validated.error ?? "The automation definition is invalid",
        );
      }
      if (validated.definition.trigger.kind === "webhook") {
        // A webhook's token is only ever shown by the create route.
        throw new Error("Webhook automations are created from the editor");
      }
      if (
        input.concurrencyPolicy !== undefined &&
        !CONCURRENCY_POLICIES.includes(input.concurrencyPolicy)
      ) {
        throw new Error("concurrencyPolicy must be skip, queue or allow");
      }
      if (
        input.maxRunSeconds !== undefined &&
        !(
          Number.isInteger(input.maxRunSeconds) &&
          input.maxRunSeconds >= MIN_RUN_SECONDS &&
          input.maxRunSeconds <= MAX_RUN_SECONDS
        )
      ) {
        throw new Error(
          `maxRunSeconds must be a whole number from ${MIN_RUN_SECONDS} to ${MAX_RUN_SECONDS}`,
        );
      }
      const created = await repository.create({
        userId,
        name,
        description: input.description ?? null,
        definition: JSON.stringify(validated.definition),
        enabled: input.enabled ?? false,
        concurrencyPolicy: input.concurrencyPolicy,
        maxRunSeconds: input.maxRunSeconds,
      });
      await syncSchedule(repository, created.id, validated.definition);
      return { id: created.id, name: created.name };
    },

    run: async (id, options = {}) => {
      const userId = actor("run");
      if (!(await ctx.rbac.has("run"))) {
        throw new Error('Running automations needs "automations.run"');
      }
      const existing = await repository.findForUser(id, userId);
      if (!existing) throw new Error("Automation not found");
      return engine.run({
        automationId: id,
        triggerType: "manual",
        triggerContext: { manual: true, requestedBy: userId },
        dryRun: options.dryRun === true,
      });
    },
  };
}
