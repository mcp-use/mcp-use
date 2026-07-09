import { describe, expect, it } from "vitest";
import { isStartPortFlagExplicit } from "../src/utils/start-port.js";

describe("isStartPortFlagExplicit", () => {
  it("returns true when --port is provided", () => {
    expect(isStartPortFlagExplicit(["node", "mcp-use", "start", "--port"])).toBe(
      true
    );
    expect(
      isStartPortFlagExplicit(["node", "mcp-use", "start", "--port=4173"])
    ).toBe(true);
  });

  it("returns false when only the -p path alias is provided", () => {
    expect(
      isStartPortFlagExplicit(["node", "mcp-use", "start", "-p", "./app"])
    ).toBe(false);
    expect(
      isStartPortFlagExplicit(["node", "mcp-use", "start", "-p=./app"])
    ).toBe(false);
  });

  it("returns false when no port flag is provided", () => {
    expect(isStartPortFlagExplicit(["node", "mcp-use", "start"])).toBe(false);
  });
});
