import type { Step } from "../../types.js";
import type { AiTaskResult } from "../deps.js";
import { renderTemplate } from "../template.js";
import { resolveTargets } from "./host-targets.js";
import {
  fail,
  ok,
  type StepExecutionContext,
  type StepResult,
  type StepRuntime,
} from "./types.js";

/**
 * Hands the step to the AI plugin's ai.tasks service. Automations picks the
 * hosts and says what happened; the AI plugin investigates, reports and, for
 * "propose", waits for someone to approve its fix on its own time.
 *
 * A dry run is passed through rather than stubbed: the AI side still looks,
 * but only reports and sends nothing.
 */
export async function runAiTask(
  step: Extract<Step, { type: "ai_task" }>,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  const run = runtime.deps.aiTasks().run;
  if (typeof run !== "function") {
    return fail("The AI plugin is not available");
  }

  const { targets, skipped } = await resolveTargets(
    step.hostSelector,
    context,
    runtime,
  );
  if (targets.length === 0) {
    return fail(
      skipped.length > 0
        ? `No accessible hosts (${skipped.length} skipped)`
        : "No hosts matched the selector",
    );
  }

  const template = context.template;
  const hostName =
    template.host?.name ?? (targets.length === 1 ? targets[0].name : "");
  const title =
    renderTemplate(step.title ?? "", template).trim() ||
    [context.automationName, hostName].filter(Boolean).join(" · ");

  let result: AiTaskResult;
  try {
    result = await run({
      automationId: context.automationId,
      automationRunId: context.runId,
      presetId: step.presetId,
      title,
      runbook: renderTemplate(step.runbook, template),
      autonomy: step.autonomy,
      hostIds: targets.map((target) => target.id),
      trigger: {
        kind: String(template.trigger?.type ?? "manual"),
        hostId: context.triggerHostId,
        summary: triggerSummary(template.trigger ?? {}),
        vars: { ...template.vars },
      },
      dryRun: context.dryRun,
      deadlineAt: context.deadlineAt,
      signal: context.signal,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  // The service is meant to fill these in itself; they are set here too so
  // later steps can always rely on them.
  const vars = {
    "ai.status": result.status,
    "ai.severity": result.severity,
    "ai.summary": result.summary,
    "ai.taskRunId": result.taskRunId === null ? "" : String(result.taskRunId),
    ...result.vars,
  };
  const skippedNote =
    skipped.length > 0 ? `\n${skipped.length} host(s) skipped: no access` : "";

  switch (result.status) {
    case "reported":
    case "proposed":
      return ok(result.summary + skippedNote, vars);
    case "skipped":
      return ok(`Skipped: ${result.summary}`, vars);
    default:
      return { success: false, error: result.summary, vars };
  }
}

/** One line on what set the run off, for the AI's prompt. */
export function triggerSummary(trigger: Record<string, unknown>): string {
  const text = (key: string) =>
    trigger[key] === undefined || trigger[key] === null
      ? ""
      : String(trigger[key]);
  const on = text("hostName") ? ` on ${text("hostName")}` : "";

  switch (text("type")) {
    case "metric_threshold": {
      const metric = text("mount")
        ? `${text("metric")} ${text("mount")}`
        : text("metric");
      const threshold = [text("operator"), text("threshold")]
        .filter(Boolean)
        .join(" ");
      return `${metric} is ${text("value")}${on} (threshold ${threshold})`;
    }
    case "host_status":
      return `${text("hostName") || "Host"} went ${text("status")}`;
    case "health_check":
      return `Health check ${text("checkId")} is ${text("state")}${on}${text("detail") ? `: ${text("detail")}` : ""}`;
    case "docker_event":
      return `Container ${text("container")} ${text("event")}${on}`;
    case "schedule":
      return `Scheduled run for ${text("scheduledFor")}`;
    case "internal_event":
      return `Termix event ${text("event")}${on}`;
    case "webhook":
      return `Incoming webhook: ${JSON.stringify(trigger.body ?? {}).slice(0, 500)}`;
    case "run_automation":
      return `Started by automation ${text("parentAutomationId")}`;
    case "manual":
      return "Run by hand";
    default:
      return text("type") || "Run by hand";
  }
}
