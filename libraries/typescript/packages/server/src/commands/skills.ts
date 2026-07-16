import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { pathExists, printResult, reportError, UsageError } from "./shared.js";

/** Run `mcp-use skills add`. */
export async function runSkills(argv: readonly string[]): Promise<number> {
  const json = argv.includes("--json");
  try {
    if (argv[0] !== "add") {
      throw new UsageError("Usage: mcp-use skills add [options]");
    }
    const { values } = parseArgs({
      args: [...argv.slice(1)],
      allowPositionals: false,
      strict: true,
      options: {
        path: { type: "string", short: "p", default: process.cwd() },
        agent: { type: "string", multiple: true },
        skill: { type: "string", multiple: true },
        json: { type: "boolean" },
      },
    });
    const cwd = resolve(values.path ?? process.cwd());
    if (!(await pathExists(cwd))) {
      throw new UsageError(`Directory not found: ${cwd}`);
    }
    const agents = values.agent ?? ["all"];
    const valid = new Set(["cursor", "claude-code", "codex", "all"]);
    for (const agent of agents) {
      if (!valid.has(agent)) throw new UsageError(`Invalid agent: ${agent}`);
    }
    const selectedAgents = agents.includes("all")
      ? ["cursor", "claude-code", "codex"]
      : [...new Set(agents)];
    const args = [
      "--yes",
      "skills",
      "add",
      "mcp-use/mcp-use",
      "--yes",
      ...selectedAgents.flatMap((agent) => ["-a", agent]),
      ...(values.skill ?? []).flatMap((skill) => ["--skill", skill]),
    ];
    const code = await spawnAndWait("npx", args, cwd);
    if (code !== 0) return code;
    printResult(
      {
        installed: true,
        path: cwd,
        agents: selectedAgents,
        skills: values.skill ?? "maintained",
      },
      json,
      "Installed mcp-use skills."
    );
    return 0;
  } catch (error) {
    return reportError(
      error instanceof TypeError ? new UsageError(error.message) : error,
      json
    );
  }
}

function spawnAndWait(
  command: string,
  args: string[],
  cwd: string
): Promise<number> {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveCode(signal === "SIGINT" ? 130 : (code ?? 1));
    });
  });
}
