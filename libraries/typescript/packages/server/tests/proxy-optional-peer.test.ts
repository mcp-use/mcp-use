import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import { proxyClientInstallError } from "../src/mcp-proxy.js";

describe("server.proxy optional peer", () => {
  it("declares @mcp-use/client as an optional peer", () => {
    expect(packageJson.peerDependencies["@mcp-use/client"]).toBe(
      "^2.0.0-alpha.0"
    );
    expect(packageJson.peerDependenciesMeta["@mcp-use/client"]?.optional).toBe(
      true
    );
  });

  it("prints an install hint when config-map proxying cannot load the peer", async () => {
    const missingClient = new Error(
      "Cannot find package '@mcp-use/client' imported from mcp-use"
    ) as NodeJS.ErrnoException;
    missingClient.code = "ERR_MODULE_NOT_FOUND";
    expect(proxyClientInstallError(missingClient)?.message).toMatch(
      /server\.proxy\(\) requires the optional @mcp-use\/client package[\s\S]*npm install @mcp-use\/client/
    );
  });
});
