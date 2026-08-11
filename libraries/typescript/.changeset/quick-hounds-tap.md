---
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
---

Drop four exports that nothing imports, and declare the `jsdom` devDependency the inspector tool-execution test already relies on through its `@vitest-environment jsdom` pragma. The dropped exports are used only inside their own modules, so this is not a change to any reachable API.
