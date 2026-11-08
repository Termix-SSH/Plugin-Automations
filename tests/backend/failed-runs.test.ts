import { expect, it } from "vitest";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { registerOperations } from "../../src/backend/operations.js";

it("counts failed runs of the last day", async () => {
  let run: (() => Promise<unknown>) | null = null;
  const ctx = {
    currentActor: () => "u1",
    operations: {
      register: (id: string, h: { run: () => Promise<unknown> }) => {
        if (id === "automations.failed-runs") run = h.run;
      },
    },
  } as unknown as PluginContext;
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  const repository = {
    listRuns: async () => [
      { status: "failed", started_at: now },
      { status: "timeout", started_at: now },
      { status: "success", started_at: now },
      { status: "failed", started_at: old },
    ],
  };
  registerOperations(ctx, repository as never, {} as never);
  const result = (await run!()) as { data: { value: number; status: string } };
  expect(result.data.value).toBe(2);
  expect(result.data.status).toBe("warn");
});
