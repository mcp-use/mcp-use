import { afterEach, describe, expect, it, vi } from "vitest";

import { cloudApiUrl, CloudApi } from "../../src/commands/cloud-api.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cloud API endpoint configuration", () => {
  it("supports the v1 URL alias while preferring the v2-specific name", () => {
    vi.stubEnv("MCP_API_URL", "http://legacy.local:8000");
    expect(cloudApiUrl()).toBe("http://legacy.local:8000/api/v1");

    vi.stubEnv("MCP_USE_CLOUD_API_URL", "http://v2.local:9000/api/v1/");
    expect(cloudApiUrl()).toBe("http://v2.local:9000/api/v1");
  });
});

describe("cloud API error normalization", () => {
  it.each([
    ["/servers/missing", 404, "server_not_found"],
    ["/deployments/missing", 404, "deployment_not_found"],
    ["/servers", 400, "validation_error"],
  ])("maps %s status %s to %s", async (path, status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status,
        text: async () =>
          JSON.stringify({
            message: "Request failed",
            details: { fieldErrors: { name: ["Required"] } },
          }),
      }))
    );

    await expect(
      CloudApi.withApiKey("test").request(path)
    ).rejects.toMatchObject({
      code,
      details: {
        status,
        validation: { fieldErrors: { name: ["Required"] } },
      },
    });
  });

  it("adds recovery commands to deployment stop failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: "Internal server error" }),
      }))
    );

    await expect(
      CloudApi.withApiKey("test").request("/deployments/dep_1/stop", {
        method: "POST",
      })
    ).rejects.toMatchObject({
      code: "deployment_stop_failed",
      details: {
        nextSteps: [
          {
            command: "mcp-use deployments get dep_1 --json",
          },
          {
            command: "mcp-use deployments delete dep_1 --yes --json",
          },
        ],
      },
    });
  });

  it("redacts submitted secrets from cloud error messages and details", async () => {
    const apiKey = "mcp_api_key_secret";
    const envValue = "database-password-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({
            message: `Invalid value ${envValue} for ${apiKey}`,
            details: { rejectedValue: envValue },
          }),
      }))
    );

    let error: unknown;
    try {
      await CloudApi.withApiKey(apiKey).request(
        "/servers/server_1/env-variables",
        {
          method: "POST",
          body: JSON.stringify({ key: "DATABASE_URL", value: envValue }),
        }
      );
    } catch (caught) {
      error = caught;
    }

    const serialized = `${String(error)}${JSON.stringify(error)}`;
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(envValue);
    expect(error).toMatchObject({
      message: "Invalid value [REDACTED] for [REDACTED]",
      details: {
        validation: { rejectedValue: "[REDACTED]" },
      },
    });
  });

  it("redacts managed environment values from multipart failures", async () => {
    const envValue = "managed-upload-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: `Rejected ${envValue}` }),
      }))
    );
    const form = new FormData();
    form.set("env", JSON.stringify({ PRIVATE_TOKEN: envValue }));

    await expect(
      CloudApi.withApiKey("api-key").multipartRequest("/servers", form)
    ).rejects.toMatchObject({
      message: "Rejected [REDACTED]",
    });
  });
});
