import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  bindShellValues,
  hasUnresolvedTokens,
  redactSecrets,
  renderRecord,
  renderShellCommand,
  renderTemplate,
} from "../../src/backend/template.js";

const context = {
  host: { id: 7, name: "Zeus", ip: "10.0.0.5", username: "root", port: 22 },
  trigger: { value: 93.4, mount: "/data" },
  steps: { check: { stdout: "ok\n", stderr: "", code: 0 } },
  vars: { target: "/var/log" },
};

describe("renderTemplate", () => {
  it("substitutes host, trigger, step and var tokens", () => {
    expect(renderTemplate("{{host.name}} at {{trigger.value}}%", context)).toBe(
      "Zeus at 93.4%",
    );
    expect(renderTemplate("{{steps.check.stdout}}", context)).toBe("ok\n");
    expect(renderTemplate("{{vars.target}}", context)).toBe("/var/log");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{  host.name  }}", context)).toBe("Zeus");
  });

  it("leaves unknown tokens in place so typos are visible", () => {
    expect(renderTemplate("{{host.nope}}", context)).toBe("{{host.nope}}");
    expect(hasUnresolvedTokens(renderTemplate("{{host.nope}}", context))).toBe(
      true,
    );
  });

  it("returns the input untouched when there is nothing to render", () => {
    expect(renderTemplate("plain text", context)).toBe("plain text");
    expect(renderTemplate("", context)).toBe("");
  });

  it("does not escape or alter shell metacharacters", () => {
    // Quoting is the caller's job; this keeps that boundary explicit.
    const rendered = renderTemplate("{{vars.payload}}", {
      vars: { payload: "; rm -rf /" },
    });
    expect(rendered).toBe("; rm -rf /");
  });

  it("does not recursively expand a value that looks like a token", () => {
    const rendered = renderTemplate("{{vars.a}}", {
      vars: { a: "{{vars.b}}", b: "gotcha" },
    });
    expect(rendered).toBe("{{vars.b}}");
  });

  it("serializes objects rather than printing [object Object]", () => {
    expect(renderTemplate("{{trigger}}", { trigger: { a: 1 } })).toBe(
      '{"a":1}',
    );
  });

  it("renders missing branches as the literal token", () => {
    expect(renderTemplate("{{steps.other.stdout}}", context)).toBe(
      "{{steps.other.stdout}}",
    );
  });
});

describe("renderRecord", () => {
  it("renders values and leaves keys alone", () => {
    expect(renderRecord({ "X-Host": "{{host.name}}" }, context)).toEqual({
      "X-Host": "Zeus",
    });
  });

  it("passes undefined through", () => {
    expect(renderRecord(undefined, context)).toBeUndefined();
  });
});

describe("redactSecrets", () => {
  it("masks credential-shaped keys", () => {
    expect(
      redactSecrets({
        Authorization: "Bearer abc",
        "X-Api-Key": "k",
        token: "t",
        password: "p",
        Accept: "application/json",
      }),
    ).toEqual({
      Authorization: "***",
      "X-Api-Key": "***",
      token: "***",
      password: "***",
      Accept: "application/json",
    });
  });
});

describe("renderShellCommand", () => {
  const evil = {
    trigger: { body: { name: "x; touch /tmp/pwned; echo $(id)" } },
  };

  it("never puts a value into the command text", () => {
    const command = renderShellCommand(
      "echo hello {{trigger.body.name}}",
      evil,
    );
    expect(command).toBe(
      "__TMX_0='x; touch /tmp/pwned; echo $(id)'\necho hello \"$__TMX_0\"",
    );
  });

  it("escapes single quotes in values", () => {
    const command = renderShellCommand("echo {{vars.v}}", {
      vars: { v: "it's" },
    });
    expect(command).toBe(`__TMX_0='it'\\''s'\necho "$__TMX_0"`);
  });

  it("quotes the reference for the spot the token sits in", () => {
    const ctx = { vars: { v: "a b" } };
    expect(renderShellCommand('echo "x {{vars.v}}"', ctx)).toBe(
      `__TMX_0='a b'\necho "x $__TMX_0"`,
    );
    expect(renderShellCommand("echo 'x {{vars.v}}'", ctx)).toBe(
      `__TMX_0='a b'\necho 'x '"$__TMX_0"''`,
    );
  });

  it("leaves commands without tokens alone", () => {
    expect(renderShellCommand("uptime", {})).toBe("uptime");
  });

  it.skipIf(process.platform === "win32")(
    "keeps the value as data in a real shell",
    () => {
      for (const template of [
        "printf %s {{trigger.body.name}}",
        'printf %s "{{trigger.body.name}}"',
      ]) {
        const out = execFileSync(
          "sh",
          ["-c", renderShellCommand(template, evil)],
          {
            encoding: "utf8",
          },
        );
        expect(out).toBe("x; touch /tmp/pwned; echo $(id)");
      }
    },
  );
});

describe("bindShellValues", () => {
  it("swaps values for quoted references", () => {
    expect(bindShellValues({ path: "/tmp; rm -rf /" })).toEqual({
      refs: { path: '"$__TMX_0"' },
      prefix: "__TMX_0='/tmp; rm -rf /'\n",
    });
  });
});
