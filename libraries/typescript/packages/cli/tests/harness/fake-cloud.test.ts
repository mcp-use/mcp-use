/**
 * The fake Cloud must refuse replies the real API could never send, or a
 * command's tests could pass against a fake that has drifted from Cloud.
 * Reply bodies are checked by the type checker (see `typeContract` below);
 * the routing behaviour is tested over HTTP, the way the CLI talks to it.
 */
import { afterEach, describe, expect, test } from "vitest";

import { deployment } from "../helpers/cloud-fixtures.js";
import { startFakeCloud, type FakeCloud } from "../helpers/fake-cloud.js";

let cloud: FakeCloud | undefined;
afterEach(async () => {
  await cloud?.close();
  cloud = undefined;
});

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${cloud!.origin}${path}`);
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? undefined : JSON.parse(text),
  };
}

/**
 * Never called. `pnpm typecheck` fails if any `@ts-expect-error` below stops
 * being an error, which is what keeps fixtures in step with the generated
 * Cloud types.
 */
function typeContract(fake: FakeCloud): void {
  const { mcpUrl: _dropped, ...withoutMcpUrl } = deployment({ id: "dep_1" });
  // @ts-expect-error -- Cloud's deployment response requires `mcpUrl`.
  fake.on("GET", "/api/v1/deployments/dep_1", { body: withoutMcpUrl });

  fake.on("POST", "/api/v1/deployments", {
    // @ts-expect-error -- creating a deployment answers 201, not 200.
    status: 200,
    body: { id: "dep_2" },
  });

  // @ts-expect-error -- `logs` must be a string, in reply functions too.
  fake.on("GET", "/api/v1/deployments/dep_1/logs", (request) => ({
    body: { logs: request.params.id.length },
  }));
}
void typeContract;

describe("fake Cloud routing", () => {
  test("answers with the route's documented success status when the reply sets none", async () => {
    cloud = await startFakeCloud();
    cloud.on("POST", "/api/v1/deployments", { body: { id: "dep_2" } });

    const response = await fetch(`${cloud.origin}/api/v1/deployments`, {
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "dep_2" });
  });

  test("passes path parameters to reply functions", async () => {
    cloud = await startFakeCloud();
    cloud.on("GET", "/api/v1/deployments/dep_42/logs", (request) => ({
      body: { logs: `logs for ${request.params.id}` },
    }));

    expect(await get("/api/v1/deployments/dep_42/logs")).toEqual({
      status: 200,
      body: { logs: "logs for dep_42" },
    });
  });

  test("accepts an error status any route can return without a documented body", async () => {
    cloud = await startFakeCloud();
    cloud.on("GET", "/api/v1/deployments/dep_1", {
      status: 503,
      body: "upstream unavailable",
    });

    expect(await get("/api/v1/deployments/dep_1")).toEqual({
      status: 503,
      body: "upstream unavailable",
    });
  });

  test("only registers paths that are Cloud routes", async () => {
    cloud = await startFakeCloud();

    expect(() =>
      // @ts-expect-error -- there is no such route.
      cloud!.on("GET", "/api/v1/deployment/dep_1", { body: {} })
    ).toThrow("is not a route in the Cloud spec");
    expect(() =>
      cloud!.onUndocumented("GET", "/api/v1/deployments/dep_1", { body: {} })
    ).toThrow("is in the Cloud spec");
  });
});
