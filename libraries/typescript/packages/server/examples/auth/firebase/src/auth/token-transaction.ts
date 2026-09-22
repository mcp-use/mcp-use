import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";

interface RequestConnection {
  client: PoolClient;
  unavailable: boolean;
}

/**
 * Serializes one OAuth client's token mutations through their final writes.
 * Waits up to one second for a PostgreSQL lock before rejecting without running
 * the operation, after acquiring a connection under the pool's configured timeout
 * (five seconds in this example). SQLite uses the SDK's process-local guard.
 */
export function createTokenTransactions(pool?: Pool) {
  const namespace = "mcp-use/firebase/oauth-client";
  if (!pool) {
    return { database: undefined, run: undefined };
  }

  const connections = new AsyncLocalStorage<RequestConnection>();
  const routedPool = new Proxy(pool, {
    get(target, property) {
      if (property === "connect") {
        return async () => {
          const current = connections.getStore();
          if (!current) return target.connect();
          if (current.unavailable)
            throw new Error("OAuth database connection closed");
          return current.client;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return value;
    },
  });

  return {
    database: routedPool,
    async run(clientId: string, operation: () => Promise<Response>) {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        logFailure("connect", clientId, error);
        return unavailable(true);
      }
      const scope: RequestConnection = { client, unavailable: false };
      const failed = (error: Error) => {
        scope.unavailable = true;
        logFailure("connection", clientId, error);
      };
      client.on("error", failed);
      scope.client = new Proxy(client, {
        get(target, property) {
          if (property === "release") return () => undefined;
          if (property === "query") {
            return (...args: unknown[]) => {
              if (scope.unavailable)
                throw new Error("OAuth database connection closed");
              const result: unknown = Reflect.apply(target.query, target, args);
              return result;
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return value;
        },
      });
      let locked = false;
      let broken = false;
      let operationStarted = false;
      try {
        const setting = await client.query<{ lock_timeout: string }>(
          "SHOW lock_timeout"
        );
        await client.query("SET lock_timeout = '1s'");
        try {
          await client.query(
            "SELECT pg_advisory_lock(hashtext($1), hashtext($2))",
            [namespace, clientId]
          );
          locked = true;
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "55P03"
          ) {
            return unavailable(true);
          }
          throw error;
        } finally {
          if (!scope.unavailable) {
            await client.query("SELECT set_config('lock_timeout', $1, false)", [
              setting.rows[0]!.lock_timeout,
            ]);
          }
        }
        operationStarted = true;
        const response = await connections.run(scope, operation);
        // The operation may already have written token state. Do not advertise
        // a retry when the connection's outcome is uncertain.
        return scope.unavailable ? unavailable(false) : response;
      } catch (error) {
        logFailure(operationStarted ? "operation" : "lock", clientId, error);
        broken = true;
        return unavailable(!operationStarted);
      } finally {
        broken ||= scope.unavailable;
        scope.unavailable = true;
        if (locked && !broken) {
          try {
            await client.query(
              "SELECT pg_advisory_unlock(hashtext($1), hashtext($2))",
              [namespace, clientId]
            );
          } catch (error) {
            logFailure("unlock", clientId, error);
            broken = true;
          }
        }
        client.removeListener("error", failed);
        client.release(broken);
      }
    },
  };
}

function logFailure(stage: string, operationKey: string, error: unknown): void {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  // PostgreSQL messages/details can contain SQL parameters, credentials or row
  // values. Stage, error type and SQLSTATE/network code identify the failure
  // without writing those values to logs. The key identifies the client/grant.
  console.error("[firebase-mcp] OAuth database operation failed", {
    stage,
    operationKey,
    errorType: error instanceof Error ? error.name : "UnknownError",
    ...(typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)
      ? { code }
      : {}),
  });
}

function unavailable(beforeOperation: boolean): Response {
  return Response.json(
    { error: "temporarily_unavailable" },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        ...(beforeOperation ? { "Retry-After": "1" } : {}),
      },
    }
  );
}
