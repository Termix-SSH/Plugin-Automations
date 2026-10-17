import { afterEach, describe, expect, it } from "vitest";
import { definition, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const schedule = definition({ kind: "schedule", cron: "0 9 * * *" });

function stored(id: number) {
  return server!.db.sqlite
    .prepare(
      "SELECT concurrency_policy, max_run_seconds, enabled FROM p_automations_automations WHERE id = ?",
    )
    .get(id) as {
    concurrency_policy: string;
    max_run_seconds: number;
    enabled: number;
  };
}

describe("automations.access create", () => {
  it("keeps the run limit and concurrency policy it is given", async () => {
    server = await startServer();
    server.mock.setActor("alice");
    const created = await server.service.create({
      name: "Daily patrol",
      definition: schedule,
      concurrencyPolicy: "queue",
      maxRunSeconds: 1800,
    });
    expect(stored(created.id)).toMatchObject({
      concurrency_policy: "queue",
      max_run_seconds: 1800,
      enabled: 0,
    });
  });

  it("uses the defaults when they are left out", async () => {
    server = await startServer();
    server.mock.setActor("alice");
    const created = await server.service.create({
      name: "Defaults",
      definition: schedule,
    });
    expect(stored(created.id)).toMatchObject({
      concurrency_policy: "skip",
      max_run_seconds: 300,
    });
  });

  it.each([
    [{ concurrencyPolicy: "sometimes" }, /concurrencyPolicy/],
    [{ maxRunSeconds: 5 }, /maxRunSeconds/],
    [{ maxRunSeconds: 99_999 }, /maxRunSeconds/],
    [{ maxRunSeconds: 60.5 }, /maxRunSeconds/],
  ])("refuses %j", async (extra, message) => {
    server = await startServer();
    server.mock.setActor("alice");
    await expect(
      server.service.create({
        name: "Bad",
        definition: schedule,
        ...(extra as object),
      }),
    ).rejects.toThrow(message);
  });
});
