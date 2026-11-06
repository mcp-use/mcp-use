import { expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { signIn, SIGNED_IN } from "../helpers/cloud-auth.js";
import { server } from "../helpers/cloud-fixtures.js";

test("servers update sends explicit build and repository settings", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", {
    body: server({ id: "srv_1", slug: "weather" }),
  });
  cloud.on("PATCH", "/api/v1/servers/srv_1", {
    body: server({ id: "srv_1", name: "Weather" }),
  });
  const result = await cli.run(
    [
      "servers",
      "update",
      "weather",
      "--name",
      "Weather",
      "--build-command",
      "npm run build",
      "--no-wait-for-ci",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.json).toMatchObject({
    server: { id: "srv_1", name: "Weather" },
  });
  expect(cloud.requestsTo("PATCH", "/api/v1/servers/srv_1")[0]?.body).toEqual({
    name: "Weather",
    waitForCi: false,
    config: { buildCommand: "npm run build" },
  });
});

test("server settings are validated before contacting Cloud", async ({
  cloud,
  cli,
}) => {
  const result = await cli.run(
    [
      "servers",
      "update",
      "weather",
      "--wait-for-ci",
      "--no-wait-for-ci",
      "--json",
    ],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(2);
  expect(result.json).toMatchObject({ error: { code: "usage_error" } });
  expect(cloud.requests).toEqual([]);
});

test("server remove alias confirms and calls the documented deletion endpoint", async ({
  cloud,
  cli,
}) => {
  signIn(cloud);
  cloud.on("GET", "/api/v1/servers/weather", {
    body: server({ id: "srv_1", slug: "weather" }),
  });
  cloud.on("DELETE", "/api/v1/servers/srv_1", { body: { success: true } });
  const result = await cli.run(
    ["servers", "remove", "weather", "--yes", "--json"],
    { env: SIGNED_IN }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json).toEqual({ success: true });
  expect(cloud.requestsTo("DELETE", "/api/v1/servers/srv_1")).toHaveLength(1);
});
