import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeContext } from "@termix-ssh/plugin-sdk/testing";
import type { PluginSshHost } from "@termix-ssh/plugin-sdk/backend";
import { executeStep } from "../../src/backend/actions/index.js";
import { triggerSummary } from "../../src/backend/actions/ai-task.js";
import type { StepExecutionContext } from "../../src/backend/actions/types.js";
import { createDeps, type AiTaskResult } from "../../src/backend/deps.js";
import { missingPlugins } from "../../src/backend/requirements.js";
import { validateDefinition } from "../../src/backend/validate.js";
import type { Step } from "../../src/types.js";
import { definition, host, startServer, type TestServer } from "./helpers";

type AiStep = Extract<Step, { type: "ai_task" }>;

const sshHost = (id: number) =>
  ({ ...host(id), password: "x" }) as unknown as PluginSshHost;

function aiStep(overrides: Partial<AiStep> = {}): AiStep {
  return {
    id: "ai",
    type: "ai_task",
    runbook: "Find out why {{host.name}} is full. Owner: {{vars.owner}}",
    autonomy: "propose",
    hostSelector: { kind: "trigger" },
    ...overrides,
  };
}

function result(overrides: Partial<AiTaskResult> = {}): AiTaskResult {
  return {
    status: "reported",
    taskRunId: 42,
    summary: "Docker build cache uses 30 GiB",
    severity: "warning",
    vars: {},
    ...overrides,
  };
}

function setup(
  run: ((input: unknown) => Promise<AiTaskResult>) | null,
  sshHosts = [sshHost(1), sshHost(2)],
) {
  const { ctx } = createFakeContext({
    pluginId: "automations",
    hosts: [host(1), host(2)],
    sshHosts,
    services: run ? { "ai.tasks": { run } } : {},
  });
  const deps = createDeps(ctx.services);
  const signal = new AbortController().signal;
  const context: StepExecutionContext = {
    userId: "alice",
    automationId: 7,
    automationName: "Disk cleanup",
    runId: 99,
    dryRun: false,
    template: {
      host: { id: 1, name: "host-1" },
      trigger: {
        type: "metric_threshold",
        hostId: 1,
        hostName: "host-1",
        metric: "disk.percent",
        mount: "/",
        value: 87,
        operator: ">=",
        threshold: 85,
      },
      steps: {},
      vars: { owner: "ops" },
    },
    triggerHostId: 1,
    ancestry: [7],
    depth: 0,
    deadlineAt: 1_900_000_000_000,
    signal,
  };
  return { deps, context, runtime: { ctx, deps }, signal };
}

describe("ai_task validation", () => {
  const validate = (step: Record<string, unknown>) =>
    validateDefinition({
      version: 1,
      trigger: { kind: "webhook", tokenHash: "x" },
      steps: [{ id: "ai", type: "ai_task", ...step }],
    });

  it("accepts a complete step", () => {
    expect(
      validate({
        runbook: "Check the disk",
        autonomy: "report",
        hostSelector: { kind: "all" },
        presetId: "disk-cleanup",
      }).ok,
    ).toBe(true);
  });

  it("needs a runbook", () => {
    expect(
      validate({
        runbook: "  ",
        autonomy: "report",
        hostSelector: { kind: "all" },
      }).error,
    ).toBe("Ask AI steps need a runbook");
  });

  it("needs a known autonomy level", () => {
    expect(
      validate({
        runbook: "Check",
        autonomy: "auto",
        hostSelector: { kind: "all" },
      }).error,
    ).toBe("Ask AI steps need a valid autonomy level");
  });

  it("needs a usable host selector", () => {
    for (const hostSelector of [
      undefined,
      { kind: "host", hostId: 0 },
      { kind: "hosts", hostIds: [] },
      { kind: "fleet" },
      { kind: "nope" },
    ]) {
      expect(
        validate({ runbook: "Check", autonomy: "report", hostSelector }).error,
      ).toBe("Ask AI steps need hosts to act on");
    }
  });
});

describe("ai_task requirements", () => {
  it("needs the ai plugin, and fleets for a fleet selector", () => {
    const definition = {
      version: 1,
      trigger: { kind: "webhook" as const, tokenHash: "x" },
      steps: [aiStep({ hostSelector: { kind: "fleet", fleetId: 3 } })],
    };
    expect(missingPlugins(definition, { available: () => false })).toEqual([
      "ai",
      "fleets",
    ]);
    expect(missingPlugins(definition, { available: () => true })).toEqual([]);
  });

  it("reports the provider in the providers map", () => {
    expect(setup(null).deps.providers().ai).toBe(false);
    expect(setup(async () => result()).deps.providers().ai).toBe(true);
  });
});

describe("ai_task executor", () => {
  it("passes the targets, trigger, variables and run limits to ai.tasks", async () => {
    const run = vi.fn(async () => result());
    const { context, runtime, signal } = setup(run);

    await executeStep(
      aiStep({ hostSelector: { kind: "all" }, presetId: "disk-cleanup" }),
      context,
      runtime,
    );

    expect(run).toHaveBeenCalledWith({
      automationId: 7,
      automationRunId: 99,
      presetId: "disk-cleanup",
      title: "Disk cleanup · host-1",
      runbook: "Find out why host-1 is full. Owner: ops",
      autonomy: "propose",
      hostIds: [1, 2],
      trigger: {
        kind: "metric_threshold",
        hostId: 1,
        summary: "disk.percent / is 87 on host-1 (threshold >= 85)",
        vars: { owner: "ops" },
      },
      dryRun: false,
      deadlineAt: 1_900_000_000_000,
      signal,
    });
  });

  it("passes a dry run through and renders a custom title", async () => {
    const run = vi.fn(async (_input: unknown) => result());
    const { context, runtime } = setup(run);
    context.dryRun = true;

    await executeStep(
      aiStep({ title: "Disk on {{host.name}}" }),
      context,
      runtime,
    );

    expect(run.mock.calls[0][0]).toMatchObject({
      dryRun: true,
      title: "Disk on host-1",
      hostIds: [1],
    });
  });

  it("leaves out hosts the owner cannot reach", async () => {
    const run = vi.fn(async (_input: unknown) => result());
    const { context, runtime } = setup(run, [sshHost(2)]);

    const outcome = await executeStep(
      aiStep({ hostSelector: { kind: "hosts", hostIds: [1, 2] } }),
      context,
      runtime,
    );

    expect(run.mock.calls[0][0]).toMatchObject({ hostIds: [2] });
    expect(outcome.output).toContain("1 host(s) skipped: no access");
  });

  it("fails without calling the AI when no host is reachable", async () => {
    const run = vi.fn(async () => result());
    const { context, runtime } = setup(run, []);

    const outcome = await executeStep(aiStep(), context, runtime);

    expect(run).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      success: false,
      error: "No accessible hosts (1 skipped)",
    });
  });

  it("succeeds with the summary and sets the ai variables", async () => {
    const { context, runtime } = setup(async () =>
      result({ status: "proposed", vars: { "ai.extra": "1" } }),
    );

    const outcome = await executeStep(aiStep(), context, runtime);

    expect(outcome).toEqual({
      success: true,
      output: "Docker build cache uses 30 GiB",
      vars: {
        "ai.status": "proposed",
        "ai.severity": "warning",
        "ai.summary": "Docker build cache uses 30 GiB",
        "ai.taskRunId": "42",
        "ai.extra": "1",
      },
    });
  });

  it("treats a skipped task as a success that says why", async () => {
    const { context, runtime } = setup(async () =>
      result({
        status: "skipped",
        taskRunId: null,
        summary: "A task for this host is still open",
      }),
    );

    const outcome = await executeStep(aiStep(), context, runtime);

    expect(outcome.success).toBe(true);
    expect(outcome.output).toBe("Skipped: A task for this host is still open");
    expect(outcome.vars).toMatchObject({
      "ai.status": "skipped",
      "ai.taskRunId": "",
    });
  });

  it("fails with the summary but still sets the variables", async () => {
    const { context, runtime } = setup(async () =>
      result({ status: "failed", summary: "Token budget used up" }),
    );

    const outcome = await executeStep(aiStep(), context, runtime);

    expect(outcome).toMatchObject({
      success: false,
      error: "Token budget used up",
      vars: { "ai.status": "failed" },
    });
  });

  it("fails when the service throws", async () => {
    const { context, runtime } = setup(async () => {
      throw new Error("AI is paused");
    });

    expect(await executeStep(aiStep(), context, runtime)).toMatchObject({
      success: false,
      error: "AI is paused",
    });
  });

  it("fails when the AI plugin is not running", async () => {
    const { context, runtime } = setup(null);

    expect(await executeStep(aiStep(), context, runtime)).toMatchObject({
      success: false,
      error: "The AI plugin is not available",
    });
  });
});

describe("triggerSummary", () => {
  it("describes each kind of trigger", () => {
    expect(
      triggerSummary({
        type: "metric_threshold",
        metric: "cpu.percent",
        value: 97,
        threshold: 90,
        hostName: "web",
      }),
    ).toBe("cpu.percent is 97 on web (threshold 90)");
    expect(
      triggerSummary({
        type: "host_status",
        status: "offline",
        hostName: "web",
      }),
    ).toBe("web went offline");
    expect(
      triggerSummary({
        type: "docker_event",
        container: "app",
        event: "exited",
        hostName: "web",
      }),
    ).toBe("Container app exited on web");
    expect(
      triggerSummary({
        type: "schedule",
        scheduledFor: "2026-10-17T09:00:00.000Z",
      }),
    ).toBe("Scheduled run for 2026-10-17T09:00:00.000Z");
    expect(triggerSummary({ type: "webhook", body: { alert: "down" } })).toBe(
      'Incoming webhook: {"alert":"down"}',
    );
    expect(triggerSummary({ type: "manual" })).toBe("Run by hand");
  });
});

describe("ai_task in a run", () => {
  let server: TestServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  const steps = [
    {
      id: "ai",
      type: "ai_task",
      runbook: "Check the disk",
      autonomy: "report",
      hostSelector: { kind: "host", hostId: 1 },
    },
    {
      id: "n",
      type: "notify",
      channelIds: [],
      title: "{{vars.ai.severity}}",
      body: "{{vars.ai.summary}}",
    },
  ];

  async function runOnce(s: TestServer) {
    const created = await s.request("POST", "/", {
      body: {
        name: "Daily check",
        definition: definition(
          { kind: "schedule", intervalSeconds: 300 },
          steps,
        ),
      },
    });
    expect(created.status).toBe(201);
    return s.request("POST", `/${created.body.id}/run`, { body: {} });
  }

  it("hands its variables to later steps", async () => {
    const run = vi.fn(async (_input: unknown) => result());
    server = await startServer({
      services: { "ai.tasks": { run } },
      sshHosts: [sshHost(1)],
    });

    const outcome = await runOnce(server);

    expect(outcome.body.status).toBe("success");
    expect(run.mock.calls[0][0]).toMatchObject({
      title: "Daily check · host-1",
      hostIds: [1],
      trigger: { kind: "manual", summary: "Run by hand" },
    });
    expect(server.mock.notifications[0].notification).toMatchObject({
      title: "warning",
      body: "Docker build cache uses 30 GiB",
    });
  });

  it("is skipped while the AI plugin is off", async () => {
    server = await startServer();

    const outcome = await runOnce(server);

    expect(outcome.body).toMatchObject({
      status: "skipped",
      error: "Needs the ai plugin",
    });
  });
});
