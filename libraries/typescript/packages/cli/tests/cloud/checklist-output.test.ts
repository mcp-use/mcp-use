import { describe, expect, test } from "vitest";
import {
  formatChecklist,
  formatChecklistMarkdown,
} from "../../src/cloud/checklist/output.js";

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

const pass = (checkId: string, category = "connectivity") => ({
  checkId,
  checkName: checkId,
  status: "pass",
  severity: "error",
  category,
});
const policyDone = pass("policy-review-summary", "policy-conformance");

test.for([
  ["pending", [], "Publishing checks queued"],
  ["running", [], "Publishing checks running"],
  ["cancelled", [], "Publishing checks cancelled"],
  ["canceled", [], "Publishing checks cancelled"],
  ["failed", [], "Publishing checks could not finish"],
  ["not_ready", [], "Not ready to test"],
  [
    "completed",
    [
      { ...pass("a"), status: "fail" },
      { ...pass("b"), status: "fail" },
    ],
    "2 required fixes before submission",
  ],
  [
    "completed",
    [{ ...pass("a"), status: "fail" }],
    "1 required fix before submission",
  ],
  [
    "completed",
    [{ ...pass("a"), status: "pending" }],
    "Publishing checks incomplete",
  ],
  [
    "completed",
    [{ ...pass("a"), status: "skip" }],
    "Publishing checks incomplete",
  ],
  [
    "completed",
    [
      pass("a"),
      { ...pass("p", "policy-conformance"), status: "fail" },
      policyDone,
    ],
    "Policy concerns need review",
  ],
  [
    "completed",
    [pass("a")],
    "Technical checks passed · policy review incomplete",
  ],
  ["completed", [pass("a"), policyDone], "Ready to submit"],
  // A failed live test doesn't block submission.
  [
    "completed",
    [pass("a"), policyDone, { ...pass("e", "e2e"), status: "fail" }],
    "Ready to submit",
  ],
  // A check that doesn't apply to the server doesn't leave the run incomplete.
  [
    "completed",
    [
      pass("a"),
      policyDone,
      {
        ...pass("views", "tool-metadata"),
        status: "skip",
        message: "No view resources found — view checks skipped",
      },
    ],
    "Ready to submit",
  ],
] as const)("a %s run with %j is titled %s", ([status, checks, title]) => {
  const markdown = formatChecklistMarkdown(
    { id: "run_1", status, checks: [...checks] },
    { dashboardUrl: "https://example.test/publish" }
  );
  expect(markdown.startsWith(`## Publishing checks\n\n${title}\n`)).toBe(true);
  expect(
    markdown.endsWith("\n\n[View dashboard](https://example.test/publish)")
  ).toBe(true);
});

test("a run that isn't ready says why and links to the dashboard", () => {
  expect(
    formatChecklistMarkdown(
      { id: "run_1", status: "not_ready", errorMessage: "Sign in first." },
      { dashboardUrl: "https://example.test/publish" }
    )
  ).toBe(
    [
      "## Publishing checks",
      "Not ready to test",
      "Sign in first.",
      "[Authenticate or reconnect in Manufact](https://example.test/publish)",
      "[View dashboard](https://example.test/publish)",
    ].join("\n\n")
  );
});

test("findings tables show ten rows and count the rest", () => {
  const checks = Array.from({ length: 12 }, (_, i) => ({
    ...pass(`check-${i + 1}`),
    status: "fail",
  }));
  const markdown = formatChecklistMarkdown(
    { id: "run_1", status: "completed", checks },
    { dashboardUrl: "https://example.test/publish" }
  );
  expect(markdown.match(/<tr><td /g)).toHaveLength(10);
  expect(markdown).toContain("<strong>check-10</strong>");
  expect(markdown).not.toContain("<strong>check-11</strong>");
  expect(markdown).toContain("</table>\n\n2 more in the checklist.\n\n");
});

describe("reports stay within GitHub's 50,000-byte check output limit", () => {
  const dashboardUrl = "https://example.test/publish";
  const link = "[View dashboard](https://example.test/publish)";
  // The action inserts a commit line after the heading; a full SHA must still fit.
  const withCommit = (markdown: string) =>
    markdown.replace(
      "## Publishing checks\n\n",
      `## Publishing checks\n\nCommit: \`${"a".repeat(40)}\`\n\n`
    );
  const shortened =
    "The prompt is shortened to fit this report. Copy the full prompt from the dashboard, or read `fixPrompt` in the `--json` result.";

  test("oversized findings and fix prompt are cut, with notes, before the dashboard link", () => {
    // Each row is 5,650 bytes once escaped, so ten rows can't fit.
    const fix = (i: number) => ({
      ...pass(`fix-${i}`),
      checkName: `Fix ${i}`,
      status: "fail",
      message: "&".repeat(600),
      hint: { text: "<".repeat(600) },
    });
    const markdown = formatChecklistMarkdown(
      {
        id: "run_1",
        status: "completed",
        fixPrompt: "Fix everything.\n".repeat(10_000),
        checks: [
          ...Array.from({ length: 12 }, (_, i) => fix(i + 1)),
          { ...pass("hint", "metadata"), status: "fail", severity: "warning" },
          policyDone,
        ],
      },
      { dashboardUrl }
    );

    expect(Buffer.byteLength(withCommit(markdown), "utf8")).toBeLessThanOrEqual(
      50_000
    );
    expect(
      markdown.startsWith(
        "## Publishing checks\n\n12 required fixes before submission\n"
      )
    ).toBe(true);
    expect(markdown.match(/<tr><td /g)).toHaveLength(8);
    expect(markdown).toContain("<strong>Fix 8</strong>");
    expect(markdown).not.toContain("<strong>Fix 9</strong>");
    expect(markdown).toContain(
      "</table>\n\nMore findings in the checklist.\n\n"
    );
    // Later tables don't fit either.
    expect(markdown).not.toContain("### Recommendations");
    expect(markdown).toContain(
      "<details><summary>Prompt for AI agents</summary>\n\n```text\nFix everything.\nFix everything.\n"
    );
    expect(markdown).toContain(
      `\n\`\`\`\n\n${shortened}\n\n</details>\n\n${link}`
    );
    expect(markdown.endsWith(`\n\n${link}`)).toBe(true);
  });

  test("a long fix prompt is shortened by bytes without splitting a character", () => {
    const markdown = formatChecklistMarkdown(
      {
        id: "run_1",
        status: "completed",
        fixPrompt: "é".repeat(60_000),
        checks: [{ ...pass("a"), status: "fail" }, policyDone],
      },
      { dashboardUrl }
    );

    expect(Buffer.byteLength(withCommit(markdown), "utf8")).toBeLessThanOrEqual(
      50_000
    );
    // Nearly all of the room is used for the prompt.
    expect(Buffer.byteLength(withCommit(markdown), "utf8")).toBeGreaterThan(
      49_800
    );
    expect(markdown).toMatch(/```text\né+\n```\n\n/);
    expect(markdown).not.toContain("�");
    expect(markdown).toContain(`\n\n${shortened}\n\n</details>\n\n${link}`);
    expect(markdown.endsWith(`\n\n${link}`)).toBe(true);
  });

  test("a fix prompt that fits is left whole", () => {
    const prompt = "Fix everything.\n".repeat(1_000).trim();
    const markdown = formatChecklistMarkdown(
      {
        id: "run_1",
        status: "completed",
        fixPrompt: prompt,
        checks: [{ ...pass("a"), status: "fail" }, policyDone],
      },
      { dashboardUrl }
    );
    expect(markdown).toContain(
      `\`\`\`text\n${prompt}\n\`\`\`\n\n</details>\n\n${link}`
    );
    expect(markdown).not.toContain("shortened");
  });
});
