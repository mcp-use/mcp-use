export const OPENAI_MODEL = "gpt-4.1-2025-04-14";

/** Cheaper/faster model for native-provider HTTP e2e (gpt-4o-mini rejects reasoning.effort). */
export const OPENAI_NATIVE_E2E_MODEL =
  process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** Public analytics-demo server used by agent native OpenAI e2e. */
export const AGENT_E2E_MCP_URL =
  process.env.MCP_AGENT_E2E_MCP_URL ??
  "https://fast-forge-tpw2s.run.mcp-use.com/mcp";
