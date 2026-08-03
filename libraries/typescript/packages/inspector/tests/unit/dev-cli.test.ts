import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDevCliApi } from "../../src/client/utils/dev-cli.js";

const win = {} as { __MCP_DEV_CLI__?: boolean };

describe("hasDevCliApi", () => {
  beforeEach(() => {
    vi.stubGlobal("window", win);
    delete win.__MCP_DEV_CLI__;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when __MCP_DEV_CLI__ is absent", () => {
    expect(hasDevCliApi()).toBe(false);
  });

  it("returns false when __MCP_DEV_CLI__ is false", () => {
    win.__MCP_DEV_CLI__ = false;
    expect(hasDevCliApi()).toBe(false);
  });

  it("returns true when __MCP_DEV_CLI__ is true", () => {
    win.__MCP_DEV_CLI__ = true;
    expect(hasDevCliApi()).toBe(true);
  });
});
