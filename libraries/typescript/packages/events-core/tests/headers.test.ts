import { describe, expect, it } from "vitest";
import {
  checkParamHeaders,
  decodeHeaderValue,
  encodeHeaderValue,
  paramHeadersFor,
  readMcpNameHeader,
  setMcpNameHeader,
  validateXMcpHeaderAnnotations,
  type EventDescriptor,
} from "../src/index.js";
import { readVector } from "./vectors.js";

const vectors = readVector<{
  cases: Array<{ value: string; header: string }>;
  undecodable: string[];
}>("header-values.json");

function descriptor(inputSchema: Record<string, unknown>): EventDescriptor {
  return {
    name: "incident.created",
    delivery: ["webhook"],
    inputSchema,
    payloadSchema: { type: "object" },
  };
}

const regionSchema = {
  type: "object",
  properties: {
    region: { type: "string", "x-mcp-header": "Region" },
    priority: { type: "integer", "x-mcp-header": "Priority" },
    urgent: { type: "boolean", "x-mcp-header": "Urgent" },
    scope: {
      type: "object",
      properties: { team: { type: "string", "x-mcp-header": "Team" } },
    },
    note: { type: "string" },
  },
};

describe("header value sentinel (vectors/header-values.json)", () => {
  for (const c of vectors.cases) {
    it(`${JSON.stringify(c.value)} ↔ ${JSON.stringify(c.header)}`, () => {
      expect(encodeHeaderValue(c.value)).toBe(c.header);
      expect(decodeHeaderValue(c.header)).toBe(c.value);
    });
  }

  for (const raw of vectors.undecodable) {
    it(`${raw} does not decode`, () => {
      expect(decodeHeaderValue(raw)).toBeUndefined();
    });
  }
});

describe("Mcp-Name", () => {
  it("setMcpNameHeader replaces an existing value instead of adding one", () => {
    const headers = new Headers({ "mcp-name": "other.event" });
    setMcpNameHeader(headers, "café.updated");
    expect([...headers.entries()]).toEqual([
      ["mcp-name", "=?base64?Y2Fmw6kudXBkYXRlZA==?="],
    ]);
    expect(readMcpNameHeader(headers)).toBe("café.updated");
  });

  it("readMcpNameHeader returns undefined for an absent header and for a bad sentinel", () => {
    expect(readMcpNameHeader(new Headers())).toBeUndefined();
    const bad = new Headers({ "Mcp-Name": "=?base64?/w==?=" });
    expect([bad.has("mcp-name"), readMcpNameHeader(bad)]).toEqual([
      true,
      undefined,
    ]);
  });
});

describe("validateXMcpHeaderAnnotations", () => {
  it("accepts annotations on string, integer and boolean properties reachable through properties", () => {
    expect(validateXMcpHeaderAnnotations(regionSchema)).toEqual({ ok: true });
    expect(validateXMcpHeaderAnnotations({ type: "object" })).toEqual({
      ok: true,
    });
  });

  const invalid: Array<[string, Record<string, unknown>, string]> = [
    [
      "an annotation under items",
      {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string", "x-mcp-header": "Tag" },
          },
        },
      },
      'tags.<items>: x-mcp-header is only allowed on properties reachable through "properties"',
    ],
    [
      "an annotation under anyOf",
      {
        type: "object",
        anyOf: [{ properties: { a: { type: "string", "x-mcp-header": "A" } } }],
      },
      '<anyOf>.a: x-mcp-header is only allowed on properties reachable through "properties"',
    ],
    [
      "an annotation on the root",
      { type: "string", "x-mcp-header": "Root" },
      '<root>: x-mcp-header is only allowed on properties reachable through "properties"',
    ],
    [
      "a header name that is not a token",
      { properties: { a: { type: "string", "x-mcp-header": "Bad Name" } } },
      "a: x-mcp-header must be a non-empty RFC 9110 token",
    ],
    [
      "an object property",
      { properties: { a: { type: "object", "x-mcp-header": "A" } } },
      "a: x-mcp-header needs a string, integer or boolean property",
    ],
    [
      "a number (not integer) property",
      { properties: { a: { type: "number", "x-mcp-header": "A" } } },
      "a: x-mcp-header needs a string, integer or boolean property",
    ],
    [
      "names equal case-insensitively",
      {
        properties: {
          a: { type: "string", "x-mcp-header": "Region" },
          b: { type: "string", "x-mcp-header": "region" },
        },
      },
      'x-mcp-header "region" duplicates "Region" (case-insensitive)',
    ],
  ];

  for (const [label, schema, reason] of invalid) {
    it(`rejects ${label}`, () => {
      expect(validateXMcpHeaderAnnotations(schema)).toEqual({
        ok: false,
        reason,
      });
    });
  }
});

describe("paramHeadersFor", () => {
  it("builds one header per annotated argument with a value, sentinel-encoding when needed", () => {
    expect(
      paramHeadersFor(descriptor(regionSchema), {
        region: "zürich-1",
        priority: 2,
        urgent: false,
        scope: { team: "core" },
        note: "not a header",
      })
    ).toEqual({
      "Mcp-Param-Region": "=?base64?esO8cmljaC0x?=",
      "Mcp-Param-Priority": "2",
      "Mcp-Param-Urgent": "false",
      "Mcp-Param-Team": "core",
    });
  });

  it("sends nothing for absent and null arguments, or for an event with invalid annotations", () => {
    expect(
      paramHeadersFor(descriptor(regionSchema), { region: null, scope: null })
    ).toEqual({});
    expect(
      paramHeadersFor(
        descriptor({
          properties: { a: { type: "object", "x-mcp-header": "A" } },
        }),
        { a: "x" }
      )
    ).toEqual({});
  });
});

describe("checkParamHeaders", () => {
  const args = { region: "us-west1", priority: 3 };

  it("accepts headers that equal the arguments, comparing integers numerically", () => {
    const headers = new Headers({
      "Mcp-Param-Region": "us-west1",
      "Mcp-Param-Priority": "3.0",
    });
    expect(checkParamHeaders(regionSchema, args, headers)).toEqual({
      ok: true,
    });
  });

  it("expects no header for an argument without a value", () => {
    expect(checkParamHeaders(regionSchema, null, new Headers())).toEqual({
      ok: true,
    });
  });

  it("reports missing, mismatched and undecodable headers", () => {
    expect([
      checkParamHeaders(
        regionSchema,
        args,
        new Headers({ "Mcp-Param-Region": "us-west1" })
      ),
      checkParamHeaders(
        regionSchema,
        args,
        new Headers({
          "Mcp-Param-Region": "eu-west1",
          "Mcp-Param-Priority": "3",
        })
      ),
      checkParamHeaders(
        regionSchema,
        args,
        new Headers({
          "Mcp-Param-Region": "=?base64?!!!!?=",
          "Mcp-Param-Priority": "3",
        })
      ),
    ]).toEqual([
      { ok: false, header: "Mcp-Param-Priority", problem: "missing" },
      { ok: false, header: "Mcp-Param-Region", problem: "mismatch" },
      { ok: false, header: "Mcp-Param-Region", problem: "invalid_encoding" },
    ]);
  });
});
