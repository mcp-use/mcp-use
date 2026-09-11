/**
 * Tests for boolean switches given an inline `=value` in the `mcp-use` bin.
 *
 * `parseArgs` splits `--flag=value` for every `--` token, but the boolean
 * cases never read the inline value. `--tunnel=false` therefore used to parse
 * as `--tunnel` and open a public tunnel — the inverse of what was asked, with
 * no diagnostic, because unknown flags do throw and so acceptance reads as
 * support. Boolean switches now reject a value instead.
 */
import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/bin/args.js";

describe("boolean switches reject an inline value", () => {
  it("rejects --tunnel=false rather than opening a tunnel", () => {
    expect(() => parseArgs(["dev", "--tunnel=false"])).toThrow(
      "--tunnel does not take a value"
    );
    expect(() => parseArgs(["start", "--tunnel=true"])).toThrow(
      "--tunnel does not take a value"
    );
  });

  it("rejects a value on the remaining boolean switches", () => {
    const cases: readonly string[] = [
      "--no-open",
      "--no-inspector",
      "--with-inspector",
      "--source-maps",
      "--inline",
      "--help",
      "--version",
    ];
    for (const flag of cases) {
      expect(() => parseArgs(["dev", `${flag}=false`])).toThrow(
        `${flag} does not take a value`
      );
    }
  });

  it("still accepts boolean switches in bare form", () => {
    expect(parseArgs(["dev", "--tunnel"]).tunnel).toBe(true);
    expect(parseArgs(["dev", "--no-open"]).open).toBe(false);
    expect(parseArgs(["dev", "--no-inspector"]).inspector).toBe(false);
    expect(parseArgs(["dev", "--with-inspector"]).inspector).toBe(true);
    expect(parseArgs(["build", "--source-maps"]).sourceMaps).toBe(true);
    expect(parseArgs(["build", "--inline"]).inline).toBe(true);
    expect(parseArgs(["dev", "--help"]).help).toBe(true);
    expect(parseArgs(["dev", "--version"]).version).toBe(true);
  });

  it("still accepts inline values on flags that take one", () => {
    expect(parseArgs(["start", "--port=8080"]).port).toBe(8080);
    expect(parseArgs(["dev", "--host=0.0.0.0"]).host).toBe("0.0.0.0");
    expect(parseArgs(["dev", "--path=./project"]).path).toBe("./project");
    expect(parseArgs(["dev", "--entry=src/server.ts"]).entry).toBe(
      "src/server.ts"
    );
    expect(parseArgs(["dev", "--mcp-dir=src/mcp"]).mcpDir).toBe("src/mcp");
    expect(parseArgs(["dev", "--views-dir=src/views"]).viewsDir).toBe(
      "src/views"
    );
  });

  it("leaves an `=` inside a positional or a passthrough argument alone", () => {
    expect(parseArgs(["dev=weird"]).command).toBe("dev=weird");
    expect(
      parseArgs(["typecheck", "--", "--extendedDiagnostics=false"]).passthrough
    ).toEqual(["--extendedDiagnostics=false"]);
  });

  it("keeps reporting an unknown flag ahead of its inline value", () => {
    expect(() => parseArgs(["dev", "--frobnicate=1"])).toThrow(
      "Unknown option: --frobnicate"
    );
  });
});
