import { describe, expect, it, vi } from "vitest";
import { watchOperationEvents } from "../../src/backend/operation-events.js";

type Handler = (event: {
  eventId: string;
  pluginId: string;
  hostId?: number;
  depth: number;
}) => void;

function setup(members: number[]) {
  let handler: Handler = () => {};
  const ctx = {
    operations: {
      onEvent: ({ handler: h }: { handler: Handler }) => {
        handler = h;
      },
    },
    asUser: async (_user: string, fn: () => unknown) => fn(),
    hosts: { checkAccess: async () => ({ hasAccess: true }) },
    rbac: { has: async () => true },
    log: { warn: vi.fn() },
  };
  const definition = {
    trigger: {
      kind: "operation_event",
      event: "docker.*",
      hostSelector: { kind: "fleet", fleetId: 4 },
    },
  };
  const repository = {
    listAllEnabled: async () => [
      { id: 1, userId: "u1", definition: JSON.stringify(definition) },
    ],
    getTriggerState: async () => null,
    upsertTriggerState: async () => undefined,
  };
  const run = vi.fn(async () => ({}));
  watchOperationEvents(
    ctx as never,
    repository as never,
    { run } as never,
    async () => false,
    {
      fleets: () => ({
        members: async () => members.map((id) => ({ id })),
      }),
    } as never,
  );
  return {
    fire: (hostId: number) =>
      handler({ eventId: "docker.down", pluginId: "docker", hostId, depth: 0 }),
    run,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("operation event triggers", () => {
  it("fires for a host in the trigger's fleet", async () => {
    const { fire, run } = setup([7]);
    fire(7);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips hosts outside the trigger's fleet", async () => {
    const { fire, run } = setup([7]);
    fire(8);
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
});
