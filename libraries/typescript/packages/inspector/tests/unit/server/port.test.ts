import { afterEach, describe, expect, it } from "vitest";
import {
  parsePortFromEnv,
  resolveInspectorPort,
} from "../../../src/server/utils.js";

describe("parsePortFromEnv", () => {
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });

  it("returns null when PORT is unset", () => {
    delete process.env.PORT;
    expect(parsePortFromEnv()).toBeNull();
  });

  it("parses a valid PORT value", () => {
    process.env.PORT = "9999";
    expect(parsePortFromEnv()).toBe(9999);
  });

  it("rejects invalid PORT values", () => {
    process.env.PORT = "not-a-port";
    expect(parsePortFromEnv()).toBeNull();

    process.env.PORT = "0";
    expect(parsePortFromEnv()).toBeNull();
  });
});

describe("resolveInspectorPort", () => {
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });

  it("prefers CLI port over PORT env and default", () => {
    process.env.PORT = "9000";
    expect(
      resolveInspectorPort({
        cliPort: 7000,
        defaultPort: 8080,
      })
    ).toBe(7000);
  });

  it("falls back to PORT env when CLI port is absent", () => {
    process.env.PORT = "9000";
    expect(
      resolveInspectorPort({
        cliPort: null,
        defaultPort: 8080,
      })
    ).toBe(9000);
  });

  it("falls back to default when neither CLI nor PORT is set", () => {
    delete process.env.PORT;
    expect(
      resolveInspectorPort({
        cliPort: null,
        defaultPort: 8080,
      })
    ).toBe(8080);
  });
});
