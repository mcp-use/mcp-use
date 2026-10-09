import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveListenHost, resolveListenPort } from "../src/listen-address.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveListenHost", () => {
  it("prefers the explicit host over HOST and the configured host", () => {
    expect(
      resolveListenHost("explicit-host", "configured-host", {
        HOST: "env-host",
      })
    ).toBe("explicit-host");
  });

  it("keeps an explicit empty host", () => {
    expect(resolveListenHost("", "configured-host", { HOST: "env-host" })).toBe(
      ""
    );
  });

  it("uses HOST when no explicit host is given", () => {
    expect(
      resolveListenHost(undefined, "configured-host", { HOST: "env-host" })
    ).toBe("env-host");
  });

  it("trims HOST before using it", () => {
    expect(
      resolveListenHost(undefined, "configured-host", { HOST: "  env-host  " })
    ).toBe("env-host");
  });

  it("ignores an empty or whitespace HOST and uses the configured host", () => {
    expect(resolveListenHost(undefined, "configured-host", { HOST: "" })).toBe(
      "configured-host"
    );
    expect(
      resolveListenHost(undefined, "configured-host", { HOST: "   " })
    ).toBe("configured-host");
  });

  it("uses the configured host when HOST is unset", () => {
    expect(resolveListenHost(undefined, "configured-host", {})).toBe(
      "configured-host"
    );
  });

  it("defaults to 127.0.0.1", () => {
    expect(resolveListenHost(undefined, undefined, {})).toBe("127.0.0.1");
  });

  it("reads HOST from process.env by default", () => {
    vi.stubEnv("HOST", "env-host");
    expect(resolveListenHost(undefined, "configured-host")).toBe("env-host");
  });
});

describe("resolveListenPort", () => {
  it("prefers the explicit port over PORT and the configured port", () => {
    expect(resolveListenPort(8080, 4100, { PORT: "4000" })).toBe(8080);
  });

  it("keeps an explicit port of 0", () => {
    expect(resolveListenPort(0, 4100, { PORT: "4000" })).toBe(0);
  });

  it("uses PORT when no explicit port is given", () => {
    expect(resolveListenPort(undefined, 4100, { PORT: "4000" })).toBe(4000);
  });

  it("ignores an empty, non-numeric, fractional, or out-of-range PORT", () => {
    for (const PORT of ["", "   ", "not-a-port", "8080.5", "65536", "-1"]) {
      expect(resolveListenPort(undefined, 4100, { PORT })).toBe(4100);
    }
  });

  it("uses the configured port when PORT is unset", () => {
    expect(resolveListenPort(undefined, 4100, {})).toBe(4100);
  });

  it("defaults to 3000", () => {
    expect(resolveListenPort(undefined, undefined, {})).toBe(3000);
  });

  it("accepts PORT boundaries 0 and 65535", () => {
    expect(resolveListenPort(undefined, 4100, { PORT: "0" })).toBe(0);
    expect(resolveListenPort(undefined, 4100, { PORT: "65535" })).toBe(65535);
  });

  it("reads PORT from process.env by default", () => {
    vi.stubEnv("PORT", "4000");
    expect(resolveListenPort(undefined, 4100)).toBe(4000);
  });
});
