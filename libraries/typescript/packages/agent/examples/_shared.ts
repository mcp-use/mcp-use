import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

export const SIMPLE_SERVER_PATH = path.resolve(
  __dirname,
  "../tests/servers/simple_server.ts"
);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export function simpleServerConfig() {
  return {
    mcpServers: {
      simple: {
        command: "tsx",
        args: [SIMPLE_SERVER_PATH],
      },
    },
  };
}

export function filesystemServerConfig(root = process.cwd()) {
  return {
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", path.resolve(root)],
      },
    },
  };
}
