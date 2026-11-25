import { describe, expect, it } from "vitest";

import { createFaviconHandler } from "../src/branding.js";

describe("data URL favicon decoding", () => {
  it("decodes case-insensitive base64 markers", async () => {
    const handler = createFaviconHandler(
      { favicon: "data:image/png;BASE64,aGk=" },
      { dev: true, projectRoot: "." }
    );

    const response = await handler!(
      new Request("http://localhost/favicon.ico")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("hi");
  });
});
