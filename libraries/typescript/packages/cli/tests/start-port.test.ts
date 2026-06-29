import { describe, expect, it } from "vitest";
import {
  hasExplicitPortFlag,
  resolveStartPort,
} from "../src/utils/start-port.js";

describe("start port resolution", () => {
  it("does not treat the -p path alias as an explicit port flag", () => {
    const argv = ["node", "mcp-use", "start", "-p", "./app"];

    expect(hasExplicitPortFlag(argv)).toBe(false);
    expect(resolveStartPort(argv, "3000", "4173")).toBe(4173);
  });

  it("uses an explicit long --port flag ahead of PORT", () => {
    const argv = ["node", "mcp-use", "start", "--port", "5050"];

    expect(hasExplicitPortFlag(argv)).toBe(true);
    expect(resolveStartPort(argv, "5050", "4173")).toBe(5050);
  });

  it("uses an explicit --port=value flag ahead of PORT", () => {
    const argv = ["node", "mcp-use", "start", "--port=5050"];

    expect(hasExplicitPortFlag(argv)).toBe(true);
    expect(resolveStartPort(argv, "5050", "4173")).toBe(5050);
  });
});
