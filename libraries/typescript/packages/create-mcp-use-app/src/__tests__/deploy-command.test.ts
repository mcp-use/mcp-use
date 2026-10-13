import { describe, expect, it } from "vitest";
import { getDeployCommand } from "../utils.js";

describe("getDeployCommand", () => {
  it("runs the project's deploy script instead of pnpm's built-in deploy", () => {
    expect(getDeployCommand("pnpm")).toBe("pnpm run deploy");
  });

  it("uses `run` for npm and bun", () => {
    expect(getDeployCommand("npm")).toBe("npm run deploy");
    expect(getDeployCommand("bun")).toBe("bun run deploy");
  });
});
