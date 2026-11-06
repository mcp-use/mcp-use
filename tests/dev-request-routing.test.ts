import { describe, expect, it } from "vitest";

import {
  isViewsRequest,
  shouldServeViteModuleRequest,
} from "../src/toolchain/dev-request-routing.js";

/**
 * Routing table regression tests for issue #3025: with views enabled and no
 * landing.tsx, a view's project imports (e.g. /src/shared.ts) must reach Vite
 * instead of falling through to the MCP handler (404), and the views prefix is
 * the resolved views directory rather than a hard-coded "/views/".
 */
describe("dev server request routing", () => {
  const base = {
    method: "GET",
    viewsEnabled: true,
    viewsUrlPrefix: "/views/",
    knownBrowserModule: false,
  };

  it("serves view files under the conventional views directory", () => {
    expect(
      shouldServeViteModuleRequest({
        ...base,
        pathname: "/views/my-view/view.tsx",
      })
    ).toBe(true);
  });

  it("serves view files under a custom views directory", () => {
    expect(
      shouldServeViteModuleRequest({
        ...base,
        viewsUrlPrefix: "/src/views/",
        pathname: "/src/views/my-view/view.tsx",
      })
    ).toBe(true);
    // The conventional prefix is not the configured one any more.
    expect(
      shouldServeViteModuleRequest({
        ...base,
        viewsUrlPrefix: "/src/views/",
        pathname: "/views/my-view/view.tsx",
      })
    ).toBe(false);
  });

  it("serves a view's project import outside the views directory", () => {
    // The module is in the Vite client graph, so the request must go to Vite
    // even though it is not under /views/ and there is no landing page.
    expect(
      shouldServeViteModuleRequest({
        ...base,
        pathname: "/src/shared.ts",
        knownBrowserModule: true,
      })
    ).toBe(true);
  });

  it("keeps the MCP endpoint on the fetch handler", () => {
    expect(shouldServeViteModuleRequest({ ...base, pathname: "/mcp" })).toBe(
      false
    );
    expect(
      shouldServeViteModuleRequest({ ...base, pathname: "/api/mcp" })
    ).toBe(false);
  });

  it("does not route non-GET requests to Vite", () => {
    expect(
      shouldServeViteModuleRequest({
        ...base,
        method: "POST",
        pathname: "/views/my-view/view.tsx",
      })
    ).toBe(false);
  });

  it("keeps Vite internals and pre-bundles on Vite", () => {
    for (const pathname of [
      "/@vite/client",
      "/@id/virtual:mcp-use/views/my-view",
      "/node_modules/.vite/deps/react.js",
      "/.mcp-use/cache/deps/react.js",
    ]) {
      expect(shouldServeViteModuleRequest({ ...base, pathname })).toBe(true);
    }
  });

  it("treats the views prefix as inert when views are disabled", () => {
    const disabled = { ...base, viewsEnabled: false };
    expect(
      isViewsRequest({ ...disabled, pathname: "/views/my-view/view.tsx" })
    ).toBe(false);
    // A landing page can still serve its own module graph.
    expect(
      shouldServeViteModuleRequest({
        ...disabled,
        pathname: "/src/shared.ts",
        knownBrowserModule: true,
      })
    ).toBe(true);
  });

  it("does not match a views prefix outside the project root", () => {
    expect(
      shouldServeViteModuleRequest({
        ...base,
        viewsUrlPrefix: undefined,
        pathname: "/views/my-view/view.tsx",
      })
    ).toBe(false);
  });
});
