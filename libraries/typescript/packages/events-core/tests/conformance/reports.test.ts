import { describe, expect, it } from "vitest";
import {
  toJSON,
  toJUnit,
  type ConformanceReport,
} from "../../src/conformance/index.js";

const REPORT: ConformanceReport = {
  target: "http://127.0.0.1:3000/mcp",
  startedAt: "2026-11-25T10:00:00.000Z",
  dialects: ["sep-3415"],
  results: [
    {
      id: "CAP-EXT",
      dialect: "sep-3415",
      level: "MUST",
      outcome: "pass",
      ms: 12,
    },
    {
      id: "POLL-NEXTPOLLMS",
      dialect: "sep-3415",
      level: "SHOULD",
      outcome: "fail",
      detail: "nextPollMs 50 & <1000",
      ms: 3,
    },
    {
      id: "CAP-EXT-LEGACY",
      dialect: "sep-3415",
      level: "INFO",
      outcome: "fail",
      detail: "extension key advertised on legacy initialize",
      ms: 1,
    },
    {
      id: "LIST-CHANGED",
      dialect: "sep-3415",
      level: "SHOULD",
      outcome: "skip",
      detail: "not automated yet",
      ms: 0,
    },
  ],
  summary: { mustFailed: 0, shouldFailed: 1, passed: 1, skipped: 1 },
};

describe("reports", () => {
  it("renders JUnit with MUST/SHOULD failures as <failure> and INFO failures as output", () => {
    expect(toJUnit(REPORT)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<testsuites name="mcp-events-conformance" tests="4" failures="1" skipped="1" time="0.016">',
        '  <testsuite name="sep-3415" tests="4" failures="1" skipped="1" time="0.016" timestamp="2026-11-25T10:00:00.000Z">',
        '    <properties><property name="target" value="http://127.0.0.1:3000/mcp"/></properties>',
        '    <testcase classname="sep-3415.CAP" name="CAP-EXT [MUST]" time="0.012"/>',
        '    <testcase classname="sep-3415.POLL" name="POLL-NEXTPOLLMS [SHOULD]" time="0.003">',
        '      <failure message="nextPollMs 50 &amp; &lt;1000" type="SHOULD"/>',
        "    </testcase>",
        '    <testcase classname="sep-3415.CAP" name="CAP-EXT-LEGACY [INFO]" time="0.001">',
        "      <system-out>INFO: extension key advertised on legacy initialize</system-out>",
        "    </testcase>",
        '    <testcase classname="sep-3415.LIST" name="LIST-CHANGED [SHOULD]" time="0.000">',
        '      <skipped message="not automated yet"/>',
        "    </testcase>",
        "  </testsuite>",
        "</testsuites>",
        "",
      ].join("\n")
    );
  });

  it("renders JSON with the report's fields", () => {
    expect(JSON.parse(toJSON(REPORT))).toEqual(REPORT);
    expect(toJSON(REPORT).endsWith("}\n")).toBe(true);
  });
});
