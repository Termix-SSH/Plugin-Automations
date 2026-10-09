import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { commandErrorText } from "../../src/backend/actions/index.js";

// Elevated commands read the host's sudo password, which core only hands to
// a plugin holding credentials:read.
describe("sudo password access", () => {
  it("declares credentials:read", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, "../../manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.capabilities).toContain("credentials:read");
  });
});

describe("commandErrorText", () => {
  it("drops the command from a timeout, so a sudo password never shows", () => {
    const error = new Error(
      "Command timeout after 5000ms: echo 'hunter2' | sudo -S -p '' sh -c 'ls'",
    );
    expect(commandErrorText(error, "hunter2")).toBe(
      "Command timeout after 5000ms",
    );
  });

  it("redacts the password anywhere else it appears", () => {
    expect(commandErrorText(new Error("bad hunter2 here"), "hunter2")).toBe(
      "bad [redacted] here",
    );
  });

  it("keeps other errors as they are", () => {
    expect(commandErrorText(new Error("Connection refused"))).toBe(
      "Connection refused",
    );
  });
});
