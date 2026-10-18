import { describe, expect, it } from "vitest";
import {
  createHeadlessViewers,
  HEARTBEAT_MS,
} from "../../src/backend/headless-viewer";

function setup(alive = () => true) {
  let clock = 0;
  const calls: string[] = [];
  const viewers = {
    register: async (hostId: number) => {
      calls.push(`register ${hostId}`);
      return { viewerSessionId: `v${hostId}-${calls.length}` };
    },
    heartbeat: (id: string) => {
      calls.push(`heartbeat ${id}`);
      return alive();
    },
    unregister: () => {},
  };
  const ctx = {
    asUser: <T>(_userId: string, fn: () => T) => Promise.resolve(fn()),
    log: { warn: () => {} },
  };
  const headless = createHeadlessViewers(
    ctx as never,
    { viewers: () => viewers } as never,
    async () => new Map([[1, "alice"]]),
    () => clock,
  );
  return {
    calls,
    headless,
    advance: (ms: number) => (clock += ms),
  };
}

describe("headless viewers", () => {
  it("heartbeats once a minute, not on every tick", async () => {
    const { calls, headless, advance } = setup();
    await headless.reconcile();
    for (let tick = 0; tick < 3; tick++) {
      advance(15_000);
      await headless.reconcile();
    }
    expect(calls).toEqual(["register 1"]);

    advance(HEARTBEAT_MS - 45_000);
    await headless.reconcile();
    advance(15_000);
    await headless.reconcile();
    expect(calls).toEqual(["register 1", "heartbeat v1-1"]);
  });

  it("registers again when host-metrics forgot the viewer", async () => {
    const { calls, headless, advance } = setup(() => false);
    await headless.reconcile();
    advance(HEARTBEAT_MS);
    await headless.reconcile();
    expect(calls).toEqual(["register 1", "heartbeat v1-1", "register 1"]);
  });

  it("keeps the margin inside host-metrics' two-minute timeout", () => {
    expect(HEARTBEAT_MS * 2).toBeLessThanOrEqual(120_000);
  });
});
