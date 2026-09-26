import { describe, expect, it } from "vitest";

import { parseMcpArguments } from "../../src/commands/client.js";
import { resolveOrganization } from "../../src/commands/cloud-api.js";
import { UsageError } from "../../src/commands/shared.js";

describe("greenfield CLI command helpers", () => {
  it("parses string and typed MCP arguments", () => {
    expect(
      parseMcpArguments([
        "name=weather",
        "count:=3",
        'options:={"metric":true}',
      ])
    ).toEqual({
      name: "weather",
      count: 3,
      options: { metric: true },
    });
  });

  it("keeps := inside a plain key=value string", () => {
    // The key ends at the first separator. Only ":=" right after the key
    // marks a typed value, so the first two stay strings and limit is 5.
    expect(
      parseMcpArguments(["code=x := 1", "query=a:=b", "limit:=5"])
    ).toEqual({
      code: "x := 1",
      query: "a:=b",
      limit: 5,
    });
  });

  it("accepts a complete JSON argument object", () => {
    expect(parseMcpArguments(['{"city":"Paris","days":2}'])).toEqual({
      city: "Paris",
      days: 2,
    });
  });

  it("reports malformed JSON as a usage error naming the argument", () => {
    expect(() => parseMcpArguments(["{bad json"])).toThrow(UsageError);
    expect(() => parseMcpArguments(["{bad json"])).toThrow(
      /^The JSON argument is not valid JSON: /
    );
    expect(() => parseMcpArguments(["count:={bad"])).toThrow(
      /^The value for "count" is not valid JSON: /
    );
  });

  it("resolves organizations only by id or slug", () => {
    const organizations = [
      { id: "org_1", slug: "acme", name: "Acme", role: "admin" },
    ];
    expect(resolveOrganization(organizations, "org_1").slug).toBe("acme");
    expect(resolveOrganization(organizations, "acme").id).toBe("org_1");
    expect(() => resolveOrganization(organizations, "Acme")).toThrow(
      /not found/i
    );
  });
});
