import { expect, test } from "vitest";
import { checklistRun } from "../../src/cloud/checklist/api.js";
import { formatChecklist } from "../../src/cloud/checklist/output.js";
import { formatAlert, formatAlertList } from "../../src/cloud/alerts/output.js";
import { formatDomain } from "../../src/cloud/domains/output.js";
import { table } from "../../src/core/format.js";

const rule = {
  id: "rule_1",
  revision: 2,
  config: {
    name: "Health",
    enabled: true,
    trigger: {
      when: {
        all: [
          { metric: "runtime.serving" as const, op: "eq" as const, value: 0 },
          {
            any: [
              {
                metric: "request.errors" as const,
                op: "gte" as const,
                value: 5,
              },
            ],
          },
        ],
      },
      for: "1m",
    },
    recover: {
      when: { metric: "runtime.serving" as const, op: "eq" as const, value: 1 },
      for: "0s",
    },
    notify: [{ type: "slack" as const }],
  },
};
test("alert output preserves nested condition semantics and does not invent state or history", () => {
  const output = formatAlert(rule, "Weather", "https://example.test/alerts");
  expect(output).toContain("All of:");
  expect(output).toContain("Any of:");
  expect(output).toContain("Serving runtime equals 0");
  expect(output).toContain("Request errors is at least 5");
  expect(output).toContain("For 1m");
  expect(output).toContain("No minimum duration");
  expect(output).not.toContain("Current state");
  expect(output).not.toContain("Activity");
  const list = formatAlertList([{ ...rule, status: "active" }], 3, "Weather");
  expect(list).toContain("Firing");
  expect(list).toContain("Enabled");
  expect(list).toContain("1 shown · 3 total");
});

test("checklist presentation uses severity, groups policy separately, and leaves JSON fields stable", () => {
  const raw = {
    id: "run_1",
    status: "completed",
    checks: [
      {
        checkId: "protocol",
        checkName: "Connect",
        category: "connectivity",
        severity: "error",
        status: "pass",
      },
      {
        checkId: "frames",
        checkName: "Frames",
        category: "resource-metadata",
        severity: "warning",
        status: "fail",
        message: "Review frames",
        hint: { text: "Remove unnecessary frames" },
      },
      {
        checkId: "policy",
        checkName: "Demo",
        category: "policy-conformance",
        severity: "warning",
        status: "fail",
      },
    ],
  };
  const parsed = checklistRun(raw, true);
  const output = formatChecklist(parsed, {
    serverName: "Weather",
    dashboardUrl: "https://example.test/checklist",
  });
  expect(output).toContain("✓ Protocol");
  expect(output).toContain("! MCP Apps");
  expect(output).toContain("1 passed · 1 warning");
  expect(output).toContain("1 policy concern");
  expect(output).toContain("Fix: Remove unnecessary frames");
  expect(output).not.toContain("✗ Frames");
  expect(output).not.toContain("✓ Connect");
  expect(
    formatChecklist(parsed, {
      serverName: "Weather",
      dashboardUrl: "",
      verbose: true,
    })
  ).toContain("✓ Connect");
  expect(checklistRun(parsed).checks?.[1]).toEqual({
    checkId: "frames",
    checkName: "Frames",
    status: "fail",
    message: "Review frames",
  });
});

test("domain guidance keeps certificate validation records and never uses a hostname ID as a domain ID", () => {
  const output = formatDomain(
    {
      domain: "mcp.example.com",
      verified: false,
      hostnameId: "provider-id",
      cnameTarget: "target.example.com",
      validationRecords: [
        { type: "TXT", name: "_verify.example.com", value: "copy-me" },
      ],
    },
    "Weather"
  );
  expect(output).toContain("Pending");
  expect(output).toContain("CNAME");
  expect(output).toContain("copy-me");
  expect(output).toContain("mcp-use domains verify");
  expect(output).not.toContain("--domain-id provider-id");
});

test("narrow output retains full identifiers and strips terminal control sequences", () => {
  const output = table(
    ["NAME", "ID"],
    [["\u001b[31mWeather\u001b[0m", "12345678-full-id-retained"]],
    30
  );
  expect(output).toContain("NAME  Weather");
  expect(output).toContain("12345678-full-id-retained");
  expect(output).not.toContain("\u001b");
});
