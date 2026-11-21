import { describe, expect, it } from "vitest";
import { validateDefinition } from "../../src/backend/validate.js";
import { matchesAlertCategory } from "../../src/backend/triggers.js";

const withTrigger = (trigger: Record<string, unknown>) =>
  validateDefinition({ version: 1, trigger, steps: [] });

describe("alert triggers", () => {
  it("take a category, a severity, title text and hosts", () => {
    expect(
      withTrigger({
        kind: "alert",
        category: "uptime.down",
        minSeverity: "critical",
        titleContains: "nginx",
        hostSelector: { kind: "host", hostId: 3 },
        cooldownMinutes: 15,
      }).ok,
    ).toBe(true);
    expect(
      withTrigger({ kind: "alert", category: "*", cooldownMinutes: 0 }).ok,
    ).toBe(true);
  });

  it("refuse a missing or odd category and unknown severities", () => {
    for (const bad of [
      { kind: "alert", category: "", cooldownMinutes: 0 },
      { kind: "alert", category: "up time", cooldownMinutes: 0 },
      { kind: "alert", category: "x", minSeverity: "huge", cooldownMinutes: 0 },
      {
        kind: "alert",
        category: "x",
        hostSelector: { kind: "nope" },
        cooldownMinutes: 0,
      },
    ]) {
      expect(withTrigger(bad).ok).toBe(false);
    }
  });

  it("match category patterns like the Alerts plugin does", () => {
    expect(matchesAlertCategory("uptime.*", "uptime.down")).toBe(true);
    expect(matchesAlertCategory("uptime.down", "uptime.up")).toBe(false);
    expect(matchesAlertCategory("*", "anything")).toBe(true);
    expect(
      matchesAlertCategory(
        "acme-ssl.renewal_failed",
        "acme-ssl.renewal_failed",
      ),
    ).toBe(true);
    expect(matchesAlertCategory("a.b", "aXb")).toBe(false);
  });
});
