/**
 * Variable substitution for automation steps.
 *
 * Templates read from the run context: {{host.name}}, {{trigger.value}},
 * {{steps.<stepId>.stdout}}, {{vars.myVar}}. renderTemplate gives back plain
 * text for URLs, bodies and messages. Anything that ends up in a shell goes
 * through renderShellCommand or bindShellValues instead, which never paste a
 * value into the command text.
 */

export interface TemplateContext {
  host?: {
    id?: number;
    name?: string;
    ip?: string;
    username?: string;
    port?: number;
  };
  trigger?: Record<string, unknown>;
  steps?: Record<string, { stdout?: string; stderr?: string; code?: number }>;
  vars?: Record<string, string>;
  run?: { id?: number; automationId?: number; startedAt?: string };
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function readPath(context: TemplateContext, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Replaces every {{token}} it can resolve. An unresolvable token is left
 * as-is so a typo shows up in the run output rather than silently becoming an
 * empty string, which is the difference between a visible mistake and a
 * command that quietly does the wrong thing.
 */
export function renderTemplate(
  input: string,
  context: TemplateContext,
): string {
  if (!input || !input.includes("{{")) return input;

  return input.replace(TOKEN, (match, path: string) => {
    const value = readPath(context, path);
    return value === undefined ? match : stringify(value);
  });
}

/** Renders every string in a flat record, leaving keys untouched. */
export function renderRecord(
  input: Record<string, string> | undefined,
  context: TemplateContext,
): Record<string, string> | undefined {
  if (!input) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = renderTemplate(value, context);
  }
  return output;
}

/** True when a template still has unresolved tokens after rendering. */
export function hasUnresolvedTokens(rendered: string): boolean {
  TOKEN.lastIndex = 0;
  return TOKEN.test(rendered);
}

const SECRET_KEY = /(authorization|token|password|secret|api[-_]?key|cookie)/i;

/**
 * Masks values whose key looks like a credential, for anything written to run
 * history or returned by the API.
 */
export function redactSecrets(
  input: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!input) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = SECRET_KEY.test(key) ? "***" : value;
  }
  return output;
}

const SHELL_VAR_PREFIX = "__TMX_";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function assignments(values: string[]): string {
  return values
    .map((value, i) => `${SHELL_VAR_PREFIX}${i}=${shellQuote(value)}\n`)
    .join("");
}

type QuoteState = "none" | "single" | "double";

/** Where a shell would be after reading `text`, starting from `state`. */
function advanceQuoteState(text: string, state: QuoteState): QuoteState {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === "single") {
      if (ch === "'") state = "none";
    } else if (ch === "\\") {
      i++;
    } else if (state === "double") {
      if (ch === '"') state = "none";
    } else if (ch === "'") {
      state = "single";
    } else if (ch === '"') {
      state = "double";
    }
  }
  return state;
}

function shellRef(index: number, state: QuoteState): string {
  const name = `$${SHELL_VAR_PREFIX}${index}`;
  if (state === "double") return name;
  if (state === "single") return `'"${name}"'`;
  return `"${name}"`;
}

/**
 * Renders a command template for a shell. Each resolved token becomes a
 * variable reference quoted for the spot it sits in (bare, inside double
 * quotes or inside single quotes) and its value is assigned up front, so a
 * value like `x; rm -rf /` is always one plain argument.
 */
export function renderShellCommand(
  input: string,
  context: TemplateContext,
): string {
  if (!input || !input.includes("{{")) return input;

  const values: string[] = [];
  let state: QuoteState = "none";
  let last = 0;
  const body = input.replace(TOKEN, (match, path: string, offset: number) => {
    state = advanceQuoteState(input.slice(last, offset), state);
    last = offset + match.length;
    const value = readPath(context, path);
    if (value === undefined) return match;
    values.push(stringify(value));
    return shellRef(values.length - 1, state);
  });
  return values.length ? assignments(values) + body : body;
}

/**
 * Swaps each value for a quoted variable reference, for callers that hand
 * values to something else that builds the command (snippets). Prepend the
 * returned prefix to whatever command comes back.
 */
export function bindShellValues(input: Record<string, string>): {
  refs: Record<string, string>;
  prefix: string;
} {
  const values: string[] = [];
  const refs: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    values.push(value);
    refs[key] = `"$${SHELL_VAR_PREFIX}${values.length - 1}"`;
  }
  return { refs, prefix: assignments(values) };
}
