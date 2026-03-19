---
"mcp-use": patch
---

Fix tool name collisions between resources, prompts, and regular tools in LangChainAdapter. The `reserveName` method now checks whether the prefixed fallback name (`resource_<name>` / `prompt_<name>`) is itself already taken, falling back to a numeric suffix when needed. Prompt names are also now sanitized consistently with resource names.
