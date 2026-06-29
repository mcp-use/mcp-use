import chalk from "chalk";
import { Command } from "commander";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  loadMcpUseProjectConfig,
  resolveMcpUseWorkspacePaths,
} from "mcp-use/project-config";
import {
  parseEvalSpec,
  runEvalSpecs,
  type EvalReport,
  type EvalRunner,
  type EvalSpec,
} from "mcp-use/eval";

interface EvalSpecFileResult {
  path: string;
  ok: boolean;
  spec?: EvalSpec;
  error?: string;
}

interface EvalValidationReport {
  ok: boolean;
  total: number;
  valid: number;
  invalid: number;
  files: EvalSpecFileResult[];
}

function hasGlobMagic(pattern: string): boolean {
  return pattern.includes("*");
}

function normalizeForMatch(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegexChar(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeForMatch(pattern);
  let source = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === "*" && next === "*") {
      const after = normalized[i + 2];
      if (after === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegexChar(char);
  }
  source += "$";
  return new RegExp(source);
}

function globBase(projectPath: string, pattern: string): string {
  const normalized = normalizeForMatch(pattern);
  const parts = normalized.split("/");
  const baseParts: string[] = [];
  for (const part of parts) {
    if (part.includes("*")) break;
    baseParts.push(part);
  }

  const base = baseParts.length > 0 ? baseParts.join("/") : ".";
  return path.resolve(projectPath, base);
}

async function walkFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function expandSpecPattern(
  projectPath: string,
  pattern: string
): Promise<string[]> {
  const absolutePattern = path.isAbsolute(pattern)
    ? pattern
    : path.join(projectPath, pattern);

  if (!hasGlobMagic(pattern)) {
    try {
      const info = await stat(absolutePattern);
      return info.isFile() ? [absolutePattern] : [];
    } catch {
      return [];
    }
  }

  const base = globBase(projectPath, pattern);
  const matcher = globToRegExp(normalizeForMatch(pattern));
  const files = await walkFiles(base);
  return files.filter((file) =>
    matcher.test(normalizeForMatch(path.relative(projectPath, file)))
  );
}

export async function resolveEvalSpecFiles(
  projectPath: string,
  patterns: string[]
): Promise<string[]> {
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const file of await expandSpecPattern(projectPath, pattern)) {
      seen.add(path.resolve(file));
    }
  }
  return [...seen].sort();
}

async function parseEvalSpecText(
  raw: string,
  filePath: string
): Promise<unknown> {
  if (filePath.endsWith(".json")) {
    return JSON.parse(raw);
  }

  const yaml = await import("yaml");
  return yaml.parse(raw);
}

export async function readEvalSpecFile(
  filePath: string
): Promise<EvalSpecFileResult> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = await parseEvalSpecText(raw, filePath);
    return {
      path: filePath,
      ok: true,
      spec: parseEvalSpec(parsed),
    };
  } catch (error) {
    return {
      path: filePath,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function validateEvalSpecFiles(
  files: string[]
): Promise<EvalValidationReport> {
  const results: EvalSpecFileResult[] = [];
  for (const file of files) {
    results.push(await readEvalSpecFile(file));
  }

  const valid = results.filter((result) => result.ok).length;
  return {
    ok: valid === results.length,
    total: results.length,
    valid,
    invalid: results.length - valid,
    files: results,
  };
}

function parseRunner(value: string | undefined): EvalRunner | undefined {
  if (value === undefined) return undefined;
  if (value === "local" || value === "cloud" || value === "chatgpt") {
    return value;
  }
  throw new Error(
    `Unknown eval runner "${value}". Expected local, cloud, or chatgpt.`
  );
}

function defaultRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveOutputPath(
  projectPath: string,
  outputDir: string,
  output?: string
) {
  if (output) {
    return path.isAbsolute(output) ? output : path.resolve(projectPath, output);
  }
  return path.resolve(projectPath, outputDir, defaultRunId(), "report.json");
}

async function writeEvalReport(report: EvalReport, outputPath: string) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
}

function printValidation(report: EvalValidationReport, projectPath: string) {
  for (const file of report.files) {
    const rel = path.relative(projectPath, file.path) || file.path;
    if (file.ok) {
      console.log(chalk.green(`✓ ${rel}`));
    } else {
      console.log(chalk.red(`✗ ${rel}`));
      console.log(chalk.gray(`  ${file.error}`));
    }
  }

  const summary = `${report.valid}/${report.total} eval spec(s) valid`;
  console.log(report.ok ? chalk.green(summary) : chalk.red(summary));
}

function printRunSummary(report: EvalReport, projectPath: string) {
  const summary = report.summary;
  const label =
    report.status === "passed" ? chalk.green("passed") : chalk.red("failed");
  console.log(
    `Eval run ${label}: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`
  );

  for (const spec of report.specs) {
    if (spec.error) {
      console.log(chalk.red(`✗ ${spec.name}: ${spec.error}`));
      continue;
    }
    for (const test of spec.tests) {
      const icon = test.status === "passed" ? chalk.green("✓") : chalk.red("✗");
      console.log(`${icon} ${spec.name} / ${test.name}`);
      if (test.error && test.status === "failed") {
        console.log(chalk.gray(`  ${test.error}`));
      }
      for (const assertion of test.assertions) {
        if (!assertion.passed && assertion.message) {
          console.log(chalk.gray(`  ${assertion.message}`));
        }
      }
    }
  }

  if (report.outputPath) {
    console.log(
      chalk.gray(
        `Report: ${path.relative(projectPath, report.outputPath) || report.outputPath}`
      )
    );
  }
}

function handleEvalError(error: unknown): never {
  console.error(
    chalk.red("Eval command failed:"),
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
}

export function createEvalCommand(): Command {
  const command = new Command("eval").description("Validate and run MCP evals");

  command
    .command("validate")
    .description("Validate eval spec files")
    .argument("[specs...]", "Eval spec files or glob patterns")
    .option("-p, --path <path>", "Path to project directory", process.cwd())
    .option("--json", "Print machine-readable JSON")
    .action(async (specs: string[], options) => {
      try {
        const projectPath = path.resolve(options.path);
        const projectConfig = await loadMcpUseProjectConfig(projectPath);
        const patterns =
          specs.length > 0 ? specs : projectConfig.config.eval.specs;
        const files = await resolveEvalSpecFiles(projectPath, patterns);
        if (files.length === 0) {
          throw new Error(`No eval spec files matched: ${patterns.join(", ")}`);
        }

        const report = await validateEvalSpecFiles(files);
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printValidation(report, projectPath);
        }
        process.exit(report.ok ? 0 : 1);
      } catch (error) {
        handleEvalError(error);
      }
    });

  command
    .command("run")
    .description("Run eval spec files")
    .argument("[specs...]", "Eval spec files or glob patterns")
    .option("-p, --path <path>", "Path to project directory", process.cwd())
    .option("--runner <runner>", "Eval runner: local, cloud, or chatgpt")
    .option("--json", "Print machine-readable JSON")
    .option("--output <path>", "Write JSON report to this path")
    .action(async (specs: string[], options) => {
      try {
        const projectPath = path.resolve(options.path);
        const projectConfig = await loadMcpUseProjectConfig(projectPath);
        const workspacePaths = resolveMcpUseWorkspacePaths(
          projectPath,
          projectConfig.config
        );
        const patterns =
          specs.length > 0 ? specs : projectConfig.config.eval.specs;
        const files = await resolveEvalSpecFiles(projectPath, patterns);
        if (files.length === 0) {
          throw new Error(`No eval spec files matched: ${patterns.join(", ")}`);
        }

        const validation = await validateEvalSpecFiles(files);
        if (!validation.ok) {
          if (options.json) {
            console.log(JSON.stringify(validation, null, 2));
          } else {
            printValidation(validation, projectPath);
          }
          process.exit(1);
        }

        const runner =
          parseRunner(options.runner) ??
          projectConfig.config.eval.defaultRunner;
        const outputPath = resolveOutputPath(
          projectPath,
          path.relative(projectPath, workspacePaths.evalRunsDir),
          options.output
        );
        const report = await runEvalSpecs(
          validation.files.map((file) => file.spec as EvalSpec),
          {
            runner,
            outputPath,
          }
        );
        await writeEvalReport(report, outputPath);

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printRunSummary(report, projectPath);
        }
        process.exit(report.status === "passed" ? 0 : 1);
      } catch (error) {
        handleEvalError(error);
      }
    });

  return command;
}
