import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SCRIPT = fileURLToPath(new URL("./record.mjs", import.meta.url));

function runRecord(input, matrix, ...flags) {
  const dir = mkdtempSync(join(tmpdir(), "live-record-"));
  const obs = join(dir, "obs.json");
  const mat = join(dir, "signal-matrix.json");
  writeFileSync(obs, JSON.stringify(input));
  if (matrix) writeFileSync(mat, JSON.stringify(matrix));
  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync("node", [SCRIPT, obs, "--matrix", mat, ...flags], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    status = err.status;
    stdout = err.stdout;
    stderr = err.stderr;
  }
  return { status, stdout, stderr, mat };
}

const chatgpt = {
  source: { run: "live-1", date: "2026-11-25" },
  observations: [
    {
      client: "chatgpt",
      profile: "web",
      signals: { era: "legacy", clientInfo: "openai-mcp" },
      answers: { V1: false, V2: true, V5: { ttlMs: 3600000 }, V18: true },
    },
  ],
};

test("--write upserts the row with evidence and keeps other rows", () => {
  const { status, stdout, mat } = runRecord(
    chatgpt,
    {
      rows: [
        { client: "mcpjam", signals: { era: "modern" }, answers: {} },
        {
          client: "chatgpt",
          profile: "web",
          signals: { era: "modern", userAgent: "ua/1" },
          answers: { V3: true },
          source: { run: "old", date: "2026-11-01" },
        },
      ],
    },
    "--write"
  );
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(readFileSync(mat, "utf8")), {
    rows: [
      {
        client: "chatgpt",
        profile: "web",
        signals: { era: "legacy", userAgent: "ua/1", clientInfo: "openai-mcp" },
        answers: {
          V3: true,
          V1: false,
          V2: true,
          V5: { ttlMs: 3600000 },
          V18: true,
        },
        source: { run: "live-1", date: "2026-11-25" },
      },
      { client: "mcpjam", signals: { era: "modern" }, answers: {} },
    ],
  });
  const proposals = JSON.parse(stdout.slice(stdout.indexOf("[")));
  assert.deepEqual(proposals, [
    {
      client: "chatgpt",
      field: "overrides.webhookId",
      value: "random",
      because: "V1",
    },
    { client: "chatgpt", field: "ttlDefaultMs", value: 3600000, because: "V5" },
    {
      client: "chatgpt",
      field: "overrides.listedModes",
      value: "servable",
      because: "V18",
    },
    {
      client: "chatgpt",
      field: "match.clientInfoName",
      value: "openai-mcp",
      because: "V2/V8",
    },
  ]);
});

test("without --write the matrix file is untouched", () => {
  const before = { rows: [] };
  const { status, mat } = runRecord(chatgpt, before);
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(readFileSync(mat, "utf8")), before);
});

test("observations without evidence are rejected", () => {
  const { status, stderr } = runRecord(
    { ...chatgpt, source: { date: "2026-11-25" } },
    null
  );
  assert.equal(status, 1);
  assert.equal(
    stderr.trim(),
    "source.run or source.url is required (evidence)"
  );
});

test("unknown signal fields are rejected", () => {
  const bad = structuredClone(chatgpt);
  bad.observations[0].signals.colour = "blue";
  const { status, stderr } = runRecord(bad, null);
  assert.equal(status, 1);
  assert.equal(
    stderr.trim(),
    "observations[0].signals.colour is not a signal-matrix field"
  );
});
