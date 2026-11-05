import { expect, test } from "vitest";
import { formatChecklist } from "../../src/cloud/checklist/output.js";

const options = {
  serverName: "Weather",
  dashboardUrl: "https://example.test/publish",
};

test("real API statuses produce counts, failure details and authoritative readiness", () => {
  const output = formatChecklist(
    {
      id: "run_1",
      status: "completed",
      gitBranch: "main",
      startedAt: "2026-11-05T10:00:00Z",
      completedAt: "2026-11-05T10:01:32Z",
      isReadyForChatgpt: true,
      isReadyForClaudeai: false,
      checks: [
        {
          checkId: "connection",
          checkName: "MCP connection",
          status: "pass",
          message: "Success detail",
        },
        { checkId: "schema", checkName: "Tool schemas", status: "pass" },
        {
          checkId: "advisory",
          checkName: "View frames",
          status: "fail",
          message: "Unexpected frame domain\nReview the view configuration.",
        },
        {
          checkId: "oauth",
          checkName: "OAuth",
          status: "skip",
          message: "Not applicable",
        },
      ],
    },
    options
  );
  expect(output).toContain("Checklist completed in 1m 32s\nWeather · main");
  expect(output).toContain("✓ MCP connection");
  expect(output).not.toContain("Success detail");
  expect(output).toContain(
    "✗ View frames\n      Unexpected frame domain\n      Review the view configuration."
  );
  expect(output).toContain("2 passed · 1 failed · 1 skipped");
  expect(output).toContain("ChatGPT   Ready");
  expect(output).toContain("Claude    Not ready");
  expect(output).toContain("mcp-use checklist get run_1");
  expect(output).toContain(options.dashboardUrl);
  expect(output).not.toContain("\u001b");
});

test("missing result metadata does not invent a duration or readiness", () => {
  const output = formatChecklist(
    { id: "run_1", status: "completed", isReadyForChatgpt: null },
    options
  );
  expect(output).toContain("No individual check results were returned.");
  expect(output).not.toMatch(
    /Ready|Not ready|ChatGPT|Claude|NaN|Invalid Date|completed in/
  );
});

test("unknown and warning statuses remain visible and failures retain their reason", () => {
  const output = formatChecklist(
    {
      id: "run_1",
      status: "failed",
      errorMessage: "Unable to finish the run",
      startedAt: "invalid",
      completedAt: "invalid",
      checks: [
        { checkId: "new", checkName: "New check", status: "new-status" },
        {
          checkId: "advisory",
          checkName: "Advisory",
          status: "warning",
          message: "Review this",
        },
      ],
    },
    options
  );
  expect(output).toContain("Checklist failed");
  expect(output).toContain("Unable to finish the run");
  expect(output).toContain("? New check");
  expect(output).toContain("1 warning · 1 unknown");
  expect(output).not.toContain("NaN");
});
