import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveListenHost, resolveListenPort } from "../src/listen-address.js";

describe("resolveListenHost", () => {
  let savedHost: string | undefined;

  beforeEach(() => {
    savedHost = process.env.HOST;
  });

  afterEach(() => {
    if (savedHost === undefined) delete process.env.HOST;
    else process.env.HOST = savedHost;
  });

  it("prefers the explicit host over HOST and the configured host", () => {
    process.env.HOST = "env-host";
    expect(resolveListenHost("explicit-host", "configured-host")).toBe(
      "explicit-host"
    );
  });

  it("uses HOST when no explicit host is given", () => {
    process.env.HOST = "env-host";
    expect(resolveListenHost(undefined, "configured-host")).toBe("env-host");
  });

  it("trims HOST before using it", () => {
    process.env.HOST = "  env-host  ";
    expect(resolveListenHost(undefined, "configured-host")).toBe("env-host");
  });

  it("ignores an empty or whitespace HOST and uses the configured host", () => {
    process.env.HOST = "";
    expect(resolveListenHost(undefined, "configured-host")).toBe(
      "configured-host"
    );

    process.env.HOST = "   ";
    expect(resolveListenHost(undefined, "configured-host")).toBe(
      "configured-host"
    );
  });

  it("uses the configured host when HOST is unset", () => {
    delete process.env.HOST;
    expect(resolveListenHost(undefined, "configured-host")).toBe(
      "configured-host"
    );
  });

  it("defaults to 127.0.0.1", () => {
    delete process.env.HOST;
    expect(resolveListenHost(undefined, undefined)).toBe("127.0.0.1");
  });
});

describe("resolveListenPort", () => {
  let savedPort: string | undefined;

  beforeEach(() => {
    savedPort = process.env.PORT;
  });

  afterEach(() => {
    if (savedPort === undefined) delete process.env.PORT;
    else process.env.PORT = savedPort;
  });

  it("prefers the explicit port over PORT and the configured port", () => {
    process.env.PORT = "4000";
    expect(resolveListenPort(8080, 4100)).toBe(8080);
  });

  it("keeps an explicit port of 0", () => {
    process.env.PORT = "4000";
    expect(resolveListenPort(0, 4100)).toBe(0);
  });

  it("uses PORT when no explicit port is given", () => {
    process.env.PORT = "4000";
    expect(resolveListenPort(undefined, 4100)).toBe(4000);
  });

  it("ignores an empty, non-integer, or out-of-range PORT", () => {
    process.env.PORT = "";
    expect(resolveListenPort(undefined, 4100)).toBe(4100);

    process.env.PORT = "   ";
    expect(resolveListenPort(undefined, 4100)).toBe(4100);

    process.env.PORT = "not-a-port";
    expect(resolveListenPort(undefined, 4100)).toBe(4100);

    process.env.PORT = "8080.5";
    expect(resolveListenPort(undefined, 4100)).toBe(4100);

    process.env.PORT = "65536";
    expect(resolveListenPort(undefined, 4100)).toBe(4100);

    process.env.PORT = "-1";
    expect(resolveListenPort(undefined, 4100)).toBe(4100);
  });

  it("uses the configured port when PORT is unset", () => {
    delete process.env.PORT;
    expect(resolveListenPort(undefined, 4100)).toBe(4100);
  });

  it("defaults to 3000", () => {
    delete process.env.PORT;
    expect(resolveListenPort(undefined, undefined)).toBe(3000);
  });

  it("accepts PORT boundaries 0 and 65535", () => {
    process.env.PORT = "0";
    expect(resolveListenPort(undefined, 4100)).toBe(0);

    process.env.PORT = "65535";
    expect(resolveListenPort(undefined, 4100)).toBe(65535);
  });
});
