import { describe, expect, it } from "vitest";
import { createConfidentialClientResolver } from "../../src/server/cli-config";

const serverUrl = "https://mcp.example.com/mcp";
const issuer = "https://login.example.com";

describe("Inspector CLI confidential-client configuration", () => {
  it("rejects malformed authorizationServers instead of widening scope", () => {
    const base = {
      serverUrls: [serverUrl],
      clientId: "client",
      clientSecret: "secret",
      authMethod: "client_secret_post",
    };

    expect(() =>
      createConfidentialClientResolver(
        JSON.stringify([{ ...base, authorizationServers: [issuer, 42] }])
      )
    ).toThrow("Invalid Inspector confidential client entry");
    expect(() =>
      createConfidentialClientResolver(
        JSON.stringify([{ ...base, authorizationServers: issuer }])
      )
    ).toThrow("Invalid Inspector confidential client entry");
  });

  it("treats omitted authorizationServers as unrestricted for compatibility", () => {
    const resolver = createConfidentialClientResolver(
      JSON.stringify([
        {
          serverUrls: [serverUrl],
          clientId: "client",
          clientSecret: "secret",
          authMethod: "client_secret_post",
        },
      ])
    );
    expect(
      resolver?.({
        serverUrl,
        targetUrl: "https://login.other.example/token",
        clientId: "client",
        authorizationServer: "https://login.other.example",
      })
    ).toMatchObject({ clientSecret: "secret" });
  });
});
