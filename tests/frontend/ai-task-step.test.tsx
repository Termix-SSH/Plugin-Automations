import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PluginApiClient } from "@termix-ssh/plugin-sdk/frontend";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const row = {
  id: 1,
  name: "Disk cleanup",
  description: null,
  enabled: 1,
  definition: {
    version: 1,
    trigger: { kind: "schedule", intervalSeconds: 300 },
    steps: [
      {
        id: "ai",
        type: "ai_task",
        runbook: "Find what fills the disk",
        autonomy: "propose",
        hostSelector: { kind: "all" },
      },
    ],
  },
  concurrency_policy: "skip",
  last_run_at: null,
  last_run_status: null,
  channels: [],
  missingPlugins: [],
};

function stubApi(ai: boolean): PluginApiClient {
  return {
    get: vi.fn(async (path: string) => {
      if (path === "/editor-options") {
        return {
          data: {
            hosts: [],
            snippets: [],
            fleets: [],
            channels: [],
            providers: { snippets: true, ai },
          },
        };
      }
      return { data: path === "/" ? [row] : [] };
    }),
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  } as unknown as PluginApiClient;
}

async function openEditor(ai: boolean) {
  rendered = await renderWithApp(plugin, {
    manifest,
    locales,
    api: stubApi(ai),
  });
  const view = within(rendered.renderPanel("automations") as HTMLElement);
  fireEvent.click(await view.findByText("Disk cleanup"));
  // The editor opens in a sheet outside the panel.
  return screen;
}

describe("Ask AI step", () => {
  it("edits the runbook, autonomy and hosts", async () => {
    const view = await openEditor(true);

    const runbook = (await view.findByDisplayValue(
      "Find what fills the disk",
    )) as HTMLTextAreaElement;
    expect(runbook.placeholder).toContain("Find out what is filling the disk");
    expect(view.getByText("Runbook")).toBeTruthy();
    expect(view.getByText("What the AI may do")).toBeTruthy();
    expect(view.getByText("Propose a fix for approval")).toBeTruthy();
    expect(view.getByText("All hosts")).toBeTruthy();
    expect(
      view.getByPlaceholderText("The automation name and host"),
    ).toBeTruthy();
  });

  it("says it needs the AI plugin when it is off", async () => {
    const view = await openEditor(false);

    await waitFor(() =>
      expect(view.getByText("Ask AI (Needs ai)")).toBeTruthy(),
    );
  });
});
