---
"@mcp-use/inspector": minor
---

fix(inspector): remove `@langchain/*` hard dependencies and drop `MCPAgent` usage

Closes [mcp-use/mcp-use#1371](https://github.com/mcp-use/mcp-use/issues/1371).

`@mcp-use/inspector` no longer depends on `@langchain/core`, `@langchain/openai`, `@langchain/anthropic`, or `@langchain/google-genai`. The chat, sampling, and props-generation paths now call the OpenAI, Anthropic, and Google REST APIs directly and run their own MCP tool-calling loop instead of going through `MCPAgent`. Consumers of `mcp-use` (which transitively installs the inspector) no longer need langchain in their `node_modules` and Next.js / Vite / other bundlers no longer fail at runtime with `Cannot find package 'langchain'`.

Preserved behavior:

- SSE wire format of the inspector's `/inspector/api/chat/stream` endpoint is unchanged (`message` / `text` / `tool-call` / `tool-result` / `done` / `error` events with identical field shapes), so existing clients — including remote consumers and the Vercel AI SDK `data-stream` parser in `useChatMessages` — keep working.
- Tool execution, multimodal image attachments, streaming partial-args rendering, OpenAI Apps SDK `openai/outputTemplate` resource hydration, cancellation via `AbortSignal`, prompts, elicitation, and widget `ui/update-model-context` injection all behave the same as before.

Provider notes:

- Gemini does not stream partial tool-call arguments incrementally (the provider only emits fully-formed `functionCall.args`), so the progressive partial-args animation only updates once per tool call for the `google` provider. Final behavior is identical.
- MCP tool schemas are automatically sanitized before being sent to Gemini to strip keywords it rejects (`$schema`, `additionalProperties`, `$ref`, etc.).
- A new regression test in `mcp-use/tests/inspector-no-langchain.test.ts` fails if any `@langchain/*`, `langchain`, or `MCPAgent` reference re-enters the inspector's `package.json` or built `dist/**`.
