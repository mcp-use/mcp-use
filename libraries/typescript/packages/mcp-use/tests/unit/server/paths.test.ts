/**
 * Tests for the `.mcp-use/` workspace path derivation — the pure, fixed-layout
 * `resolveWorkspacePaths` deriver. There is no config file: the layout is a
 * convention rooted at the project directory.
 */

import { describe, expect, it } from "vitest";
import {
  BUILD_MANIFEST_NAME,
  resolveWorkspacePaths,
  WORKSPACE_DIR_NAME,
} from "../../../src/server/config/paths.js";

describe("resolveWorkspacePaths", () => {
  it("derives the full fixed layout from a project root", () => {
    const p = resolveWorkspacePaths("/projects/orders");

    expect(p.projectRoot).toBe("/projects/orders");
    expect(p.workspace).toBe("/projects/orders/.mcp-use");
    expect(p.build).toBe("/projects/orders/.mcp-use/build");
    expect(p.generated).toBe("/projects/orders/.mcp-use/generated");
    expect(p.cache).toBe("/projects/orders/.mcp-use/cache");
    expect(p.state).toBe("/projects/orders/.mcp-use/state");
    expect(p.cloud).toBe("/projects/orders/.mcp-use/cloud");

    expect(p.buildManifest).toBe(
      "/projects/orders/.mcp-use/build/manifest.json"
    );
    expect(p.toolRegistry).toBe(
      "/projects/orders/.mcp-use/generated/tool-registry.d.ts"
    );
    expect(p.viewProps).toBe(
      "/projects/orders/.mcp-use/generated/view-props.d.ts"
    );
    expect(p.sessions).toBe("/projects/orders/.mcp-use/state/sessions.json");
    expect(p.tunnel).toBe("/projects/orders/.mcp-use/state/tunnel.json");
    expect(p.cloudLink).toBe("/projects/orders/.mcp-use/cloud/link.json");
  });

  it("exposes the canonical workspace + manifest names", () => {
    expect(WORKSPACE_DIR_NAME).toBe(".mcp-use");
    expect(BUILD_MANIFEST_NAME).toBe("manifest.json");
  });
});
