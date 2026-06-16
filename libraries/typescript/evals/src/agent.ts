import { query } from "@anthropic-ai/claude-agent-sdk";
import { sanitizedEnv } from "./proc.js";
import type { AgentRunInfo } from "./types.js";

const DEFAULT_TIMEOUT_MS = 20 * 60_000;

export function assertAgentAuth(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required to run agents (the Agent SDK authenticates with it). " +
        "Use `--agent golden` to exercise the graders without an agent."
    );
  }
}

/**
 * Run a Claude Code agent in the workspace via the Agent SDK (bundled CLI,
 * authenticated with ANTHROPIC_API_KEY — independent of any local `claude`
 * install or login). The full event log is preserved (rawJsonl) and condensed
 * into a human/judge-readable transcript.
 */
export async function runClaudeAgent(opts: {
  workspace: string;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  /** trial-specific env (e.g. the OAuth task's live IdP config) */
  extraEnv?: Record<string, string>;
}): Promise<AgentRunInfo> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  const events: Record<string, unknown>[] = [];
  let stderrTail = "";
  try {
    const stream = query({
      prompt: opts.prompt,
      options: {
        cwd: opts.workspace,
        model: opts.model,
        permissionMode: "bypassPermissions",
        // Only the sandbox's own .claude/ (where the skill variant installs
        // mcp-builder) — never the local user's ~/.claude.
        settingSources: ["project"],
        // Replaces the subprocess env entirely (SDK semantics) — keeps
        // ANTHROPIC_API_KEY, drops harness/user-shell leakage.
        env: { ...sanitizedEnv(), ...opts.extraEnv },
        abortController: abort,
        stderr: (data) => {
          stderrTail = (stderrTail + data).slice(-2000);
        },
      },
    });
    for await (const message of stream) {
      events.push(message as unknown as Record<string, unknown>);
    }
  } catch (err) {
    if (abort.signal.aborted) {
      events.push({
        type: "harness",
        note: `agent timed out after ${timeoutMs}ms and was aborted`,
      });
    } else {
      events.push({
        type: "harness",
        note: `agent SDK error: ${String(err)}${stderrTail ? `\nstderr: ${stderrTail}` : ""}`,
      });
    }
  } finally {
    clearTimeout(timer);
  }

  const result = events.find((e) => e.type === "result");
  return {
    durationMs: numberField(result, "duration_ms"),
    turns: numberField(result, "num_turns"),
    costUsd: numberField(result, "total_cost_usd"),
    rawJsonl: events.map((e) => JSON.stringify(e)).join("\n"),
    transcriptMd: renderTranscript(events),
  };
}

function numberField(
  obj: Record<string, unknown> | undefined,
  key: string
): number | null {
  const v = obj?.[key];
  return typeof v === "number" ? v : null;
}

/** Condense agent events into a readable transcript (also fed to the judge). */
export function renderTranscript(events: Record<string, unknown>[]): string {
  const out: string[] = [];
  for (const e of events) {
    if (e.type === "assistant" || e.type === "user") {
      const message = e.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content as Record<string, unknown>[]) {
        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim()
        ) {
          out.push(block.text.trim());
        } else if (block.type === "tool_use") {
          out.push(
            `\`[tool] ${String(block.name)}(${truncate(JSON.stringify(block.input ?? {}), 300)})\``
          );
        } else if (block.type === "tool_result") {
          const isError = block.is_error === true;
          const text = truncate(
            flattenToolResult(block.content),
            isError ? 500 : 200
          );
          out.push(`\`[result${isError ? " ERROR" : ""}]\` ${text}`);
        }
      }
    } else if (e.type === "result") {
      const status = e.subtype === "success" ? "" : ` ${String(e.subtype)}`;
      out.push(
        `---\n[run result]${status} turns=${e.num_turns ?? "?"} cost=$${e.total_cost_usd ?? "?"} duration=${e.duration_ms ?? "?"}ms`
      );
    } else if (e.type === "harness") {
      out.push(`---\n[harness] ${String(e.note)}`);
    }
  }
  return out.join("\n\n");
}

function flattenToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === "object" && c !== null && "text" in c
          ? String((c as { text: unknown }).text)
          : ""
      )
      .join(" ");
  }
  return JSON.stringify(content ?? "");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
