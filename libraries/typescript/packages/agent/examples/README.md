# `@mcp-use/agent` examples

In-repo samples for the native and LangChain MCP agents. Install dependencies from the TypeScript workspace root (`pnpm install` in `libraries/typescript`).

## Prerequisites

- Node.js ≥ 22.22.2
- API keys in the environment (see table below)
- Run from `libraries/typescript/packages/agent`:

```bash
OPENAI_API_KEY=... pnpm exec tsx examples/basic/simplified_agent_example.ts
```

Set `AGENT_EXAMPLE_DEMO=1` for non-interactive chat verification.

## Basic

| Example | Entry | Description | Requires |
| --- | --- | --- | --- |
| [simplified_agent_example.ts](basic/simplified_agent_example.ts) | native | Simplified `llm` + `mcpServers` API | `OPENAI_API_KEY` |
| [chat_example.ts](basic/chat_example.ts) | native | Interactive chat with memory | `OPENAI_API_KEY` |
| [mcp_everything.ts](basic/mcp_everything.ts) | native | Exercise `@modelcontextprotocol/server-everything` | `OPENAI_API_KEY` |

## Advanced

| Example | Entry | Description | Requires |
| --- | --- | --- | --- |
| [stream_example.ts](advanced/stream_example.ts) | native | `stream()` steps + native `streamEvents()` | `OPENAI_API_KEY` |
| [structured_output.ts](advanced/structured_output.ts) | langchain | Zod schema on `run()` | `OPENAI_API_KEY` |
| [observability.ts](advanced/observability.ts) | langchain | Langfuse metadata and tags | `OPENAI_API_KEY`, Langfuse keys |

## Code mode

| Example | Entry | Description | Requires |
| --- | --- | --- | --- |
| [code_mode_example.ts](code-mode/code_mode_example.ts) | langchain | Local VM code mode | `ANTHROPIC_API_KEY` |
| [code_mode_e2b_example.ts](code-mode/code_mode_e2b_example.ts) | langchain | E2B remote sandbox | `ANTHROPIC_API_KEY`, `E2B_API_KEY`, `@e2b/code-interpreter` |

## Frameworks

| Example | Entry | Description | Requires |
| --- | --- | --- | --- |
| [ai_sdk_example.ts](frameworks/ai_sdk_example.ts) | langchain | Vercel AI SDK `createTextStreamResponse` | `ANTHROPIC_API_KEY` |

## Integrations

| Example | Entry | Description | Requires |
| --- | --- | --- | --- |
| [airbnb_use.ts](integrations/airbnb_use.ts) | native | Airbnb MCP server | `OPENAI_API_KEY` |
| [blender_use.ts](integrations/blender_use.ts) | native | Blender MCP (addon must be running) | `ANTHROPIC_API_KEY` |
| [browser_use.ts](integrations/browser_use.ts) | native | Playwright MCP | `OPENAI_API_KEY` |
| [filesystem_use.ts](integrations/filesystem_use.ts) | native | Filesystem MCP server | `OPENAI_API_KEY` |

## Server management

| Example | Entry | Description | Requires |
| --- | --- | --- | --- |
| [multi_server_example.ts](server-management/multi_server_example.ts) | native | Multiple servers in one agent | `ANTHROPIC_API_KEY` |
| [add_server_tool.ts](server-management/add_server_tool.ts) | langchain | Dynamic server add via Server Manager | `OPENAI_API_KEY` |

## Verify locally

```bash
pnpm example:verify
```

Runs examples that only need `OPENAI_API_KEY` and local MCP servers. Skips examples that need Langfuse, E2B, Blender, or heavy external integrations when env vars are missing.
