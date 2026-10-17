import type {
  AutomationDefinition,
  HostSelector,
  Step,
  Trigger,
} from "../types.js";
import { AUTOMATION_DEFINITION_VERSION } from "../types.js";
import { isValidCron, isValidTimezone } from "./cron.js";

const TRIGGER_KINDS = new Set([
  "metric_threshold",
  "host_status",
  "health_check",
  "schedule",
  "docker_event",
  "internal_event",
  "webhook",
]);

const STEP_TYPES = new Set([
  "notify",
  "http",
  "run_snippet",
  "run_command",
  "docker",
  "tunnel",
  "wol",
  "ai_task",
  "wait",
  "set_var",
  "if",
  "run_automation",
  "stop",
]);

const OPERATORS = new Set([
  ">",
  "<",
  ">=",
  "<=",
  "==",
  "!=",
  "contains",
  "not_contains",
  "changed",
]);

const AUTONOMY_LEVELS = new Set(["report", "propose"]);

const isId = (value: unknown) => Number.isInteger(value) && Number(value) > 0;

function isValidHostSelector(selector: HostSelector | undefined): boolean {
  switch (selector?.kind) {
    case "host":
      return isId(selector.hostId);
    case "hosts":
      return (
        Array.isArray(selector.hostIds) &&
        selector.hostIds.length > 0 &&
        selector.hostIds.every(isId)
      );
    case "fleet":
      return isId(selector.fleetId);
    case "all":
    case "trigger":
      return true;
    default:
      return false;
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates a definition before it is stored. The engine treats the stored
 * blob as trusted, so everything it relies on is checked once here.
 */
export function validateDefinition(value: unknown): {
  ok: boolean;
  error?: string;
  definition?: AutomationDefinition;
} {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Definition must be an object" };
  }

  const candidate = value as Partial<AutomationDefinition>;
  const trigger = candidate.trigger as Trigger | undefined;

  if (!trigger || !TRIGGER_KINDS.has(trigger.kind)) {
    return { ok: false, error: "Unknown or missing trigger kind" };
  }

  if (trigger.kind === "metric_threshold") {
    if (!OPERATORS.has(trigger.operator)) {
      return { ok: false, error: "Unknown comparison operator" };
    }
    if (typeof trigger.value !== "number" || !Number.isFinite(trigger.value)) {
      return { ok: false, error: "Threshold value must be a number" };
    }
    if (!trigger.metric?.path) {
      return { ok: false, error: "Trigger is missing a metric" };
    }
  }

  if (trigger.kind === "schedule") {
    const hasInterval =
      typeof trigger.intervalSeconds === "number" &&
      trigger.intervalSeconds > 0;
    const hasCron = isNonEmptyString(trigger.cron);
    if (!hasInterval && !hasCron) {
      return { ok: false, error: "Schedule needs an interval or a cron" };
    }
    if (hasCron && !isValidCron(trigger.cron as string)) {
      return { ok: false, error: "Cron expression is not valid" };
    }
    if (hasInterval && (trigger.intervalSeconds as number) < 60) {
      return { ok: false, error: "Interval must be at least 60 seconds" };
    }
    if (
      isNonEmptyString(trigger.timezone) &&
      !isValidTimezone(trigger.timezone)
    ) {
      return { ok: false, error: "Time zone is not valid" };
    }
  }

  const steps = candidate.steps;
  if (!Array.isArray(steps)) {
    return { ok: false, error: "Definition must include a steps array" };
  }

  const seen = new Set<string>();
  const stepError = validateSteps(steps as Step[], seen);
  if (stepError) return { ok: false, error: stepError };

  return {
    ok: true,
    definition: {
      version: candidate.version ?? AUTOMATION_DEFINITION_VERSION,
      trigger,
      steps: steps as Step[],
    },
  };
}

function validateSteps(steps: Step[], seen: Set<string>): string | null {
  for (const step of steps) {
    if (!step || typeof step !== "object") return "Step must be an object";
    if (!isNonEmptyString(step.id)) return "Every step needs an id";
    if (seen.has(step.id)) return `Duplicate step id: ${step.id}`;
    seen.add(step.id);
    if (!STEP_TYPES.has(step.type)) {
      return `Unknown step type: ${step.type}`;
    }

    if (step.type === "if") {
      if (!step.condition || !OPERATORS.has(step.condition.operator)) {
        return "Condition needs a valid operator";
      }
      const thenError = validateSteps(step.then ?? [], seen);
      if (thenError) return thenError;
      const elseError = validateSteps(step.else ?? [], seen);
      if (elseError) return elseError;
    }

    if (step.type === "http" && !isNonEmptyString(step.url)) {
      return "HTTP steps need a URL";
    }
    if (step.type === "run_command" && !isNonEmptyString(step.command)) {
      return "Command steps need a command";
    }
    if (step.type === "ai_task") {
      if (!isNonEmptyString(step.runbook)) return "Ask AI steps need a runbook";
      if (!AUTONOMY_LEVELS.has(step.autonomy)) {
        return "Ask AI steps need a valid autonomy level";
      }
      if (!isValidHostSelector(step.hostSelector)) {
        return "Ask AI steps need hosts to act on";
      }
    }
    if (step.type === "wait" && typeof step.seconds !== "number") {
      return "Wait steps need a number of seconds";
    }
    if (step.type === "set_var" && !isNonEmptyString(step.name)) {
      return "Variable steps need a name";
    }
    if (
      step.type === "run_automation" &&
      !(Number.isInteger(step.automationId) && step.automationId > 0)
    ) {
      return "Nested automation steps need an automation id";
    }
  }
  return null;
}
