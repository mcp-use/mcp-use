/**
 * Tests for basePath normalization and the asset route builders. These are the
 * single source of truth for where the framework HTTP surface relocates under
 * the server-wide `basePath` (default `/mcp`).
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_PATH,
  normalizeBasePath,
  publicAssetBase,
  widgetAssetBase,
} from "../../../src/server/config/base-path.js";

describe("normalizeBasePath", () => {
  it("defaults to /mcp when undefined", () => {
    expect(normalizeBasePath()).toBe("/mcp");
    expect(normalizeBasePath(undefined)).toBe("/mcp");
    expect(DEFAULT_BASE_PATH).toBe("/mcp");
  });

  it("leaves an already-normalized path untouched", () => {
    expect(normalizeBasePath("/mcp")).toBe("/mcp");
    expect(normalizeBasePath("/api/v1")).toBe("/api/v1");
  });

  it("adds a single leading slash", () => {
    expect(normalizeBasePath("mcp")).toBe("/mcp");
    expect(normalizeBasePath("api/v1")).toBe("/api/v1");
  });

  it("strips trailing slashes", () => {
    expect(normalizeBasePath("/mcp/")).toBe("/mcp");
    expect(normalizeBasePath("mcp///")).toBe("/mcp");
  });

  it("collapses duplicate slashes", () => {
    expect(normalizeBasePath("/api//v1")).toBe("/api/v1");
    expect(normalizeBasePath("//mcp")).toBe("/mcp");
  });

  it("treats empty and root as root-mounted (empty prefix)", () => {
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("///")).toBe("");
    expect(normalizeBasePath("  ")).toBe("");
  });

  it("produces usable route fragments when root-mounted", () => {
    const bp = normalizeBasePath("/");
    expect(`${bp}/sse`).toBe("/sse");
    expect(widgetAssetBase(bp)).toBe("/mcp-use/widgets");
    expect(publicAssetBase(bp)).toBe("/mcp-use/public");
  });
});

describe("route builders", () => {
  it("widgetAssetBase prefixes basePath", () => {
    expect(widgetAssetBase("/mcp")).toBe("/mcp/mcp-use/widgets");
    expect(widgetAssetBase("")).toBe("/mcp-use/widgets");
    expect(widgetAssetBase("/api/v1")).toBe("/api/v1/mcp-use/widgets");
  });

  it("publicAssetBase prefixes basePath", () => {
    expect(publicAssetBase("/mcp")).toBe("/mcp/mcp-use/public");
    expect(publicAssetBase("")).toBe("/mcp-use/public");
    expect(publicAssetBase("/api/v1")).toBe("/api/v1/mcp-use/public");
  });
});
