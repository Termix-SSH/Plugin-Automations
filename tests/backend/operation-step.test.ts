import { describe, expect, it, vi } from "vitest";
import { createFakeContext } from "@termix-ssh/plugin-sdk/testing";
import type { PluginSshHost } from "@termix-ssh/plugin-sdk/backend";
import { executeStep } from "../../src/backend/actions/index.js";
import type { StepExecutionContext } from "../../src/backend/actions/types.js";
import { createDeps } from "../../src/backend/deps.js";
import { validateDefinition } from "../../src/backend/validate.js";
import type { Step } from "../../src/types.js";
import { host } from "./helpers";

type OperationStep = Extract<Step, { type: "operation" }>;

function setup(dryRun = false) {
  const { ctx } = createFakeContext({
    pluginId: "automations",
    hosts: [host(1), host(2)],
    sshHosts: [1, 2].map(
      (id) => ({ ...host(id), password: "x" }) as unknown as PluginSshHost,
    ),
  });
  const invoke = vi.fn(async () => ({
    runId: "r",
    status: "success",
    summary: "Restarted web",
  }));
  ctx.operations.invoke = invoke as never;
  const context: StepExecutionContext = {
    userId: "alice",
    automationId: 7,
    automationName: "Fix it",
    runId: 1,
    dryRun,
    template: {
      host: { id: 1, name: "host-1" },
      trigger: { type: "manual", hostId: 1, container: "web" },
      steps: {},
      vars: {},
    },
    triggerHostId: 1,
    ancestry: [7],
    depth: 0,
    deadlineAt: 1_900_000_000_000,
  };
  return { invoke, context, runtime: { ctx, deps: createDeps(ctx.services) } };
}

const step = (overrides: Partial<OperationStep> = {}): OperationStep => ({
  id: "op",
  type: "operation",
  actionId: "docker.restart-container",
  hostSelector: { kind: "trigger" },
  resourceKey: "{{trigger.container}}",
  input: { reason: "{{automation.name}}", force: true },
  ...overrides,
});

describe("operation step", () => {
  it("runs the action through the gate as an automation", async () => {
    const { invoke, context, runtime } = setup();
    const outcome = await executeStep(step(), context, runtime);
    expect(outcome.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "docker.restart-container",
      expect.objectContaining({
        hostId: 1,
        resourceKey: "web",
        via: "automation",
        dryRun: false,
        input: expect.objectContaining({ force: true }),
      }),
    );
  });

  it("asks the gate for a dry run instead of skipping", async () => {
    const { invoke, context, runtime } = setup(true);
    await executeStep(step(), context, runtime);
    expect(invoke).toHaveBeenCalledWith(
      "docker.restart-container",
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("runs a server action once with no host", async () => {
    const { invoke, context, runtime } = setup();
    await executeStep(
      step({ hostSelector: undefined, resourceKey: undefined }),
      context,
      runtime,
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((invoke.mock.calls[0] as unknown[])[1]).toMatchObject({
      hostId: undefined,
    });
  });

  it("fails while waiting for approval", async () => {
    const { invoke, context, runtime } = setup();
    invoke.mockResolvedValueOnce({
      runId: "r",
      status: "pending_approval",
    } as never);
    const outcome = await executeStep(step(), context, runtime);
    expect(outcome.success).toBe(false);
  });

  it("is checked when saved", () => {
    const definition = (steps: unknown[]) => ({
      version: 1,
      trigger: {
        kind: "operation_event",
        event: "docker.*",
        cooldownMinutes: 5,
      },
      steps,
    });
    expect(validateDefinition(definition([step()])).ok).toBe(true);
    expect(
      validateDefinition(definition([step({ actionId: "rm -rf" })])).ok,
    ).toBe(false);
    expect(
      validateDefinition({
        ...definition([]),
        trigger: { kind: "operation_event", event: "", cooldownMinutes: 5 },
      }).ok,
    ).toBe(false);
  });
});
