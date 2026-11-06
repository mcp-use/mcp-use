import { afterEach, expect, test, vi } from "vitest";
import { callerFor, createCloudClient } from "../../src/cloud/api/client.js";
import { serverCreationTimeout } from "../../src/cloud/deploy/errors.js";

afterEach(() => vi.unstubAllGlobals());

test.each([408, 504, 524])(
  "an HTML HTTP %s proxy timeout preserves timeout recovery instead of leaking HTML",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html>The origin web server exceeded its 120-second Proxy Read Timeout.</html>",
            { status, headers: { "Content-Type": "text/html" } }
          )
      )
    );
    const client = createCloudClient({ apiKey: "test_key" });
    await expect(
      callerFor("test_key")(
        client.POST("/api/v1/servers", {
          body: {
            type: "github",
            organizationId: "org_1",
            installationId: "inst_1",
            repoFullName: "example/weather",
            name: "Weather",
            branch: "main",
          },
        }),
        serverCreationTimeout()
      )
    ).rejects.toMatchObject({
      code: "cloud_timeout",
      message: expect.stringContaining("Creation may still have succeeded"),
      nextSteps: expect.arrayContaining([
        {
          description: expect.any(String),
          command: "mcp-use servers list --json",
        },
      ]),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

test("a hosting router's missing application is reported as an unavailable API", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          status: "error",
          code: 404,
          message: "Application not found",
          request_id: "request-1",
        },
        { status: 404 }
      )
    )
  );
  const client = createCloudClient({ apiKey: "test_key" });
  await expect(
    callerFor("test_key")(
      client.GET("/api/v1/servers/{id}", { params: { path: { id: "srv_1" } } }),
      { notFound: { code: "server_not_found" } }
    )
  ).rejects.toMatchObject({
    code: "cloud_unreachable",
    message: expect.stringContaining(
      "hosting service could not find the application"
    ),
  });
});

test("a backend-wrapped proxy timeout retains deployment recovery", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          error:
            "The origin web server did not return a complete response within the 120-second Proxy Read Timeout window.",
        },
        { status: 500 }
      )
    )
  );
  const client = createCloudClient({ apiKey: "test_key" });
  await expect(
    callerFor("test_key")(
      client.GET("/api/v1/organizations"),
      serverCreationTimeout()
    )
  ).rejects.toMatchObject({
    code: "cloud_timeout",
    message: expect.stringContaining("Creation may still have succeeded"),
  });
});

test("application-level missing resources retain the command's not-found error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "Server not found" }, { status: 404 })
    )
  );
  const client = createCloudClient({ apiKey: "test_key" });
  await expect(
    callerFor("test_key")(
      client.GET("/api/v1/servers/{id}", { params: { path: { id: "srv_1" } } }),
      { notFound: { code: "server_not_found" } }
    )
  ).rejects.toMatchObject({
    code: "server_not_found",
    message: "Server not found",
  });
});

test("a client-side fetch timeout also preserves the uncertain-outcome guidance", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new DOMException("Timed out", "TimeoutError");
    })
  );
  const client = createCloudClient({ apiKey: "test_key" });
  await expect(
    callerFor("test_key")(
      client.GET("/api/v1/organizations"),
      serverCreationTimeout()
    )
  ).rejects.toMatchObject({
    code: "cloud_timeout",
    message: expect.stringContaining("creating the server"),
  });
});

test("other non-JSON proxy errors produce a concise HTTP error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("<html>Proxy diagnostic dump</html>", { status: 503 })
    )
  );
  const client = createCloudClient({ apiKey: "test_key" });
  await expect(
    callerFor("test_key")(client.GET("/api/v1/organizations"))
  ).rejects.toMatchObject({
    code: "cloud_api_error",
    message: "Manufact Cloud request failed (HTTP 503).",
  });
});
