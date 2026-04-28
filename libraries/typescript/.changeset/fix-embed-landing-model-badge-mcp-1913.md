---
"@mcp-use/inspector": patch
---

fix(inspector): suppress duplicate model UI when embedded with `managedLlmConfig` + `hideModelBadge` (MCP-1913)

If the user had a bring-your-own-key config in `localStorage`, `effectiveClientSide` became true. The host can pass `managedLlmConfig` and `hideModelBadge` (e.g. cloud dashboard with `ServerChatHeader` + `LLMModelSelector`), but the inspector still showed its own `provider/model` UI: the landing pill below the input, and (in threaded view) `ChatHeader`'s absolute model badge — overlapping the dashboard title and model row.

When `managedLlmConfig` and `hideModelBadge` are both set, the inspector now suppresses that duplicate chrome in both landing and non-landing views. Standalone hosted behavior is unchanged when the host does not pass this embed pair.

Additionally, for `useClientSide={false}` + `managedLlmConfig` (host-owned chat stream), the chat path no longer auto-switches to client-side streaming when `localLlmConfig` exists in `localStorage` from a past standalone inspector session. The host’s `chatApiUrl` (e.g. org chat stream) is used unless the user explicitly opts into BYOK (`forceClientSide` via rate-limit / “use your own key”).
