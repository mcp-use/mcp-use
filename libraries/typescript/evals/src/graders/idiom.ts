import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Finding, IdiomFindings, TaskConfig } from "../types.js";

/**
 * Friction detectors: deterministic pattern checks over the produced source.
 * This catalog IS our definition of "idiomatic mcp-use" — every detector that
 * fires frequently across trials is a docs/skill/SDK/template work item with
 * evidence attached. Add a detector whenever the SDK grows a helper agents
 * should adopt.
 *
 * Detector hits are diagnostics, not a grade: they measure whether agents
 * discover our affordances, so they're reported as findings (and per-detector
 * hit rates in trends), never blended into a score.
 */
interface Detector {
  id: string;
  lever: Finding["lever"];
  appliesTo: (task: TaskConfig) => boolean;
  detect: (files: Map<string, string>, task: TaskConfig) => Finding[];
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".mcp-use",
  ".claude",
  "public",
]);

const RESPONSE_HELPERS = [
  "text",
  "object",
  "markdown",
  "error",
  "image",
  "html",
  "xml",
  "json",
  "audio",
];

const DETECTORS: Detector[] = [
  {
    // Agent bypassed mcp-use and built on the raw protocol SDK — the single
    // clearest "couldn't discover our API" signal.
    id: "raw-sdk-import",
    lever: "docs",
    appliesTo: () => true,
    detect: (files) =>
      grepFiles(
        files,
        /from\s+["']@modelcontextprotocol\/sdk/,
        (file, line, text) => ({
          detector: "raw-sdk-import",
          file,
          line,
          evidence: text.trim(),
          lever: "docs",
        })
      ),
  },
  {
    // Hand-rolled `{ content: [{ type: "text", ... }] }` instead of text()/object()
    id: "hand-rolled-content-block",
    lever: "skill",
    appliesTo: () => true,
    detect: (files) =>
      grepFiles(
        files,
        /content:\s*\[\s*\{[^}]*type:\s*["'](?:text|image)["']/,
        (file, line, text) => ({
          detector: "hand-rolled-content-block",
          file,
          line,
          evidence: text.trim(),
          lever: "skill",
        })
      ),
  },
  {
    // Registers tools but never imports a response helper from mcp-use/server
    id: "no-response-helper-import",
    lever: "docs",
    appliesTo: () => true,
    detect: (files) => {
      let registersTools = false;
      let importsHelper = false;
      for (const content of files.values()) {
        if (/\.tool\s*\(/.test(content)) registersTools = true;
        for (const match of content.matchAll(
          /import\s*\{([^}]*)\}\s*from\s*["']mcp-use(?:\/server)?["']/g
        )) {
          const names = match[1]
            .split(",")
            .map((n) => n.trim().split(/\s+as\s+/)[0]);
          if (names.some((n) => RESPONSE_HELPERS.includes(n)))
            importsHelper = true;
        }
      }
      if (registersTools && !importsHelper) {
        return [
          {
            detector: "no-response-helper-import",
            evidence:
              "tools are registered but no response helper (text/object/markdown/…) is imported from mcp-use/server",
            lever: "docs",
          },
        ];
      }
      return [];
    },
  },
  {
    // Auth task solved without the SDK's oauth support (`oauth:` server config
    // with a provider such as oauthCustomProvider) — the agent hand-rolled
    // middleware/header checks instead, i.e. never discovered the affordance.
    id: "hand-rolled-auth",
    lever: "docs",
    appliesTo: (task) => Boolean(task.auth),
    detect: (files) => {
      for (const content of files.values()) {
        if (
          /\boauth\s*:/.test(content) ||
          /\boauth\w*(Provider|Proxy)\s*\(/.test(content)
        )
          return [];
      }
      return [
        {
          detector: "hand-rolled-auth",
          evidence:
            "bearer auth implemented without the SDK's oauth support (no `oauth:` server config / oauth*Provider factory)",
          lever: "docs",
        },
      ];
    },
  },
  {
    // Task requires typed inputs but no zod schema is wired through
    id: "missing-zod-schema",
    lever: "docs",
    appliesTo: (task) => task.requiresZodSchema,
    detect: (files) => {
      let importsZod = false;
      let usesSchemaKey = false;
      for (const content of files.values()) {
        if (/from\s*["']zod["']/.test(content)) importsZod = true;
        if (/schema\s*:/.test(content)) usesSchemaKey = true;
      }
      if (!importsZod || !usesSchemaKey) {
        return [
          {
            detector: "missing-zod-schema",
            evidence: importsZod
              ? "zod is imported but no `schema:` is passed to a tool definition"
              : "zod is never imported — tool inputs are untyped/unvalidated",
            lever: "docs",
          },
        ];
      }
      return [];
    },
  },
];

export async function gradeIdiom(
  workspace: string,
  task: TaskConfig
): Promise<IdiomFindings> {
  const files = await collectSourceFiles(workspace);
  return gradeIdiomFiles(files, task);
}

/** Pure core, separated for direct unit testing. */
export function gradeIdiomFiles(
  files: Map<string, string>,
  task: TaskConfig
): IdiomFindings {
  const findings: Finding[] = [];
  for (const detector of DETECTORS) {
    if (!detector.appliesTo(task)) continue;
    findings.push(...detector.detect(files, task));
  }
  return { findings };
}

function grepFiles(
  files: Map<string, string>,
  pattern: RegExp,
  toFinding: (file: string, line: number, text: string) => Finding
): Finding[] {
  const findings: Finding[] = [];
  for (const [file, content] of files) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i]))
        findings.push(toFinding(file, i + 1, lines[i]));
    }
    // multi-line patterns (content blocks often span lines)
    if (pattern.flags.includes("s") || findings.every((f) => f.file !== file)) {
      const multi = content.match(new RegExp(pattern.source, "s"));
      if (multi && !findings.some((f) => f.file === file)) {
        const line = content.slice(0, multi.index ?? 0).split("\n").length;
        findings.push(toFinding(file, line, multi[0].split("\n")[0]));
      }
    }
  }
  return findings;
}

export async function collectSourceFiles(
  workspace: string
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  await walk(workspace, workspace, files);
  return files;
}

async function walk(
  root: string,
  dir: string,
  files: Map<string, string>
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name))
        await walk(root, join(dir, entry.name), files);
    } else if (
      SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))
    ) {
      const path = join(dir, entry.name);
      files.set(relative(root, path), await readFile(path, "utf8"));
    }
  }
}
