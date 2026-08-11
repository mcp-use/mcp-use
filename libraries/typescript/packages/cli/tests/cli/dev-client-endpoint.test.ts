import { describe, expect, it } from "vitest";

import { resolveDevClientEndpoint } from "../../src/cli/dev-client-endpoint.js";

describe("resolveDevClientEndpoint", () => {
  it("uses the public MCP origin for remote sandbox assets and HMR", () => {
    expect(
      resolveDevClientEndpoint(
        "0.0.0.0",
        3000,
        "https://sb-example.sandbox.dev.manufact.com/mcp"
      )
    ).toEqual({
      origin: "https://sb-example.sandbox.dev.manufact.com",
      hmr: {
        protocol: "wss",
        host: "sb-example.sandbox.dev.manufact.com",
        clientPort: 443,
      },
    });
  });

  it("keeps local development on the selected listener port", () => {
    expect(resolveDevClientEndpoint("127.0.0.1", 43127, undefined)).toEqual({
      origin: "http://localhost:43127",
      hmr: {
        protocol: "ws",
        host: "localhost",
        clientPort: 43127,
      },
    });
  });

  it("uses explicit non-default public ports", () => {
    expect(
      resolveDevClientEndpoint(
        "0.0.0.0",
        3000,
        "https://sandbox.example.test:8443/api/mcp"
      )
    ).toMatchObject({
      origin: "https://sandbox.example.test:8443",
      hmr: {
        protocol: "wss",
        host: "sandbox.example.test",
        clientPort: 8443,
      },
    });
  });

  it("ignores credential-bearing public URLs", () => {
    expect(
      resolveDevClientEndpoint(
        "0.0.0.0",
        3000,
        "https://token@example.test/mcp"
      )
    ).toMatchObject({
      origin: "http://localhost:3000",
      hmr: { protocol: "ws", host: "localhost", clientPort: 3000 },
    });
  });
});
