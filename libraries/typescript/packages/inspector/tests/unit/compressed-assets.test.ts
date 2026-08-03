import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { mountInspector } from "../../src/server/index.js";

describe("compressed Inspector assets", () => {
  it("serves stored gzip bytes and a byte-identical identity fallback", async () => {
    const handler = mountInspector({ basePath: "/mcp" });
    const url = "http://localhost/mcp/inspector/assets/inspector.js";

    const compressedResponse = await handler(
      new Request(url, { headers: { "Accept-Encoding": "gzip" } })
    );
    const compressed = Buffer.from(await compressedResponse.arrayBuffer());
    expect(compressedResponse.headers.get("content-encoding")).toBe("gzip");
    expect(compressedResponse.headers.get("vary")).toBe("Accept-Encoding");

    const identityResponse = await handler(new Request(url));
    const identity = Buffer.from(await identityResponse.arrayBuffer());
    expect(identityResponse.headers.get("content-encoding")).toBeNull();
    expect(identityResponse.headers.get("vary")).toBe("Accept-Encoding");
    expect(identity).toEqual(gunzipSync(compressed));
  });
});
