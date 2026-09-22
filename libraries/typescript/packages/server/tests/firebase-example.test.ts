import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";

import { createFirebaseAuth } from "../examples/auth/firebase/src/auth/index.js";
import { createTokenTransactions } from "../examples/auth/firebase/src/auth/token-transaction.js";

vi.mock(
  "mcp-use/oauth/better-auth-mcp",
  () => import("../src/oauth/better-auth-mcp.js")
);
vi.mock(
  "mcp-use/oauth/native-identity",
  () => import("../src/oauth/native-identity.js")
);

afterEach(() => vi.restoreAllMocks());

it("reports an incompatible database column instead of recommending automatic migration", async () => {
  const db = new DatabaseSync(":memory:");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const auth = await createFirebaseAuth({
      resource: "http://localhost:3000/mcp",
      database: db,
      secret: "firebase-example-test-secret-32-characters",
      firebase: {
        projectId: "firebase-test",
        apiKey: "fixture-key",
        authDomain: "firebase-test.firebaseapp.com",
        appId: "1:123:web:abc",
      },
    });
    await (await auth.getMigrations()).runMigrations();
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mcp_%_user'"
      )
      .get()!.name as string;
    db.exec(`ALTER TABLE "${table}" ADD COLUMN legacy_required TEXT NOT NULL`);
    await expect(auth.getMigrations()).rejects.toThrow(
      "requires manual repair"
    );
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain(table);
    expect(output).toContain("legacy_required");
    expect(output).toContain("pnpm migrate cannot fix");
  } finally {
    db.close();
  }
});

it.each(["connect", "operation"] as const)(
  "logs the %s failure without exposing database values or changing retry behavior",
  async (stage) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(
      new Error("private credentials in database detail"),
      {
        code: stage === "connect" ? "ECONNREFUSED" : "23505",
        detail: "private row values",
      }
    );
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async () => ({ rows: [{ lock_timeout: "0" }] })),
      release: vi.fn(),
    });
    const pool = {
      connect: vi.fn(async () => {
        if (stage === "connect") throw error;
        return client;
      }),
    } as unknown as NonNullable<Parameters<typeof createTokenTransactions>[0]>;
    const operation = vi.fn(async (): Promise<Response> => {
      throw error;
    });
    const response = await createTokenTransactions(pool).run!(
      "test-client",
      operation
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe(
      stage === "connect" ? "1" : null
    );
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(operation).toHaveBeenCalledTimes(stage === "connect" ? 0 : 1);
    expect(log).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        stage,
        operationKey: "test-client",
        code: error.code,
      })
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /private credentials|private row values/
    );
    if (stage === "operation")
      expect(client.release).toHaveBeenCalledWith(true);
  }
);
