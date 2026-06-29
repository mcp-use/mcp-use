import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "../../../src/server/views/mcp-apps-constants.js";
import {
  discoverWidgetFileEntries,
  shouldMountWidgets,
} from "../../../src/server/views/discover-widget-files.js";

describe("mcp-apps-constants", () => {
  it("exports SEP-1865 constants", () => {
    expect(RESOURCE_URI_META_KEY).toBe("ui/resourceUri");
    expect(RESOURCE_MIME_TYPE).toBe("text/html;profile=mcp-app");
  });
});

describe("shouldMountWidgets", () => {
  let tempDir: string;
  const prevCwd = process.cwd;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-use-widgets-"));
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    process.cwd = prevCwd;
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MCP_USE_WIDGETS_DIR;
    delete process.env.NODE_ENV;
  });

  it("returns false for tool-only servers with no resources dir", async () => {
    expect(await shouldMountWidgets()).toBe(false);
    expect(await discoverWidgetFileEntries()).toEqual([]);
  });

  it("returns true when a widget file exists in resources/", async () => {
    mkdirSync(join(tempDir, "resources"), { recursive: true });
    writeFileSync(
      join(tempDir, "resources", "chart.tsx"),
      "export default () => null"
    );

    expect(await discoverWidgetFileEntries()).toHaveLength(1);
    expect(await shouldMountWidgets()).toBe(true);
  });

  it("returns true when MCP_USE_WIDGETS_DIR points at widgets", async () => {
    const widgetsDir = join(tempDir, "src", "mcp", "resources");
    mkdirSync(widgetsDir, { recursive: true });
    writeFileSync(join(widgetsDir, "panel.tsx"), "export default () => null");
    process.env.MCP_USE_WIDGETS_DIR = "src/mcp/resources";

    expect(await shouldMountWidgets()).toBe(true);
  });

  it("returns true for inline-only production manifests", async () => {
    process.env.NODE_ENV = "production";
    mkdirSync(join(tempDir, "dist"), { recursive: true });
    writeFileSync(
      join(tempDir, "dist", "mcp-use.json"),
      JSON.stringify({
        inlineWidgetTools: {
          "get-weather": {
            widgetName: "weather-card",
            componentPath: "/project/components/WeatherCard.tsx",
          },
        },
      })
    );

    expect(await shouldMountWidgets()).toBe(true);
  });
});
