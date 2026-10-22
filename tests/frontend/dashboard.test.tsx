import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { PluginApiClient } from "@termix-ssh/plugin-sdk/frontend";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import {
  automationTouchesHost,
  nextRunOf,
} from "../../src/frontend/AutomationsDashboard";
import type { AutomationRow } from "../../src/frontend/automations-api";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

function row(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 1,
    user_id: "u",
    name: "Nightly backup",
    description: null,
    enabled: 1,
    definition: {
      version: 1,
      trigger: { kind: "schedule", intervalSeconds: 3600 },
      steps: [
        {
          id: "s1",
          type: "command",
          hosts: { kind: "hosts", hostIds: [4, 9] },
        },
      ],
    } as never,
    definition_version: 1,
    concurrency_policy: "skip" as never,
    max_run_seconds: 60,
    dry_run: 0,
    last_run_at: null,
    last_run_status: null,
    created_at: "",
    updated_at: "",
    channels: [],
    ...overrides,
  };
}

const run = {
  id: 5,
  automation_id: 1,
  user_id: "u",
  trigger_type: "manual",
  trigger_context: null,
  status: "failed",
  started_at: new Date().toISOString(),
  finished_at: null,
  duration_ms: 10,
  error: "boom",
  dry_run: 0,
  parent_run_id: null,
  automation_name: "Nightly backup",
};

function api(): PluginApiClient {
  return {
    get: vi.fn(async (url: string) => ({
      data: url === "/" ? [row()] : url === "/runs/history" ? [run] : [],
    })),
    post: vi.fn(async () => ({ data: {} })),
  } as unknown as PluginApiClient;
}

describe("automations dashboard and panel", () => {
  it("finds the automations that name a host", () => {
    expect(automationTouchesHost(row(), 9)).toBe(true);
    expect(automationTouchesHost(row(), 3)).toBe(false);
  });

  it("works out the next scheduled run", () => {
    const from = new Date("2026-10-21T10:00:00Z");
    expect(nextRunOf(row(), from)?.toISOString()).toBe(
      "2026-10-21T11:00:00.000Z",
    );
    expect(nextRunOf(row({ enabled: 0 }), from)).toBeNull();
  });

  it("registers both cards and the panel toggle", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales, api: api() });
    expect(rendered.registered.dashboardCards().sort()).toEqual([
      "automations-runs",
      "automations-upcoming",
    ]);
    expect(rendered.registered.slot("tab.menu")).toEqual([
      "automations.togglePanel",
    ]);
  });

  it("shows upcoming automations and recent runs", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(),
      permissions: ["automations.view", "automations.run"],
    });
    rendered.renderDashboardCard("automations-upcoming");
    expect(await screen.findByText(/in 1 hour|in 60 minutes/)).toBeTruthy();
    rendered.renderDashboardCard("automations-runs");
    expect(await screen.findByText("Failed")).toBeTruthy();
  });
});
