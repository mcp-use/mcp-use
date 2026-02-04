---
"mcp-use": patch
---

fix(server): HMR tool schema preservation, prompt/resource handler wrappers for CallToolResult conversion, preserve widget resources during HMR, and prompt content normalization

**HMR Schema Preservation:**

- Fixed tool schema handling during HMR to use Zod schemas directly instead of converting to params
- Changed empty schema from `{}` to `z.object({})` to ensure `safeParseAsync` works correctly
- Preserves full Zod validation capabilities during hot module reload

**Handler Wrapper Improvements:**

- Added automatic handler wrapping for prompts and resources to support `CallToolResult` format
- Prompts now support tool response helpers (`text()`, `object()`, `image()`, etc.) via automatic conversion to `GetPromptResult`
- Resources now support tool response helpers via automatic conversion to `ReadResourceResult`
- Applied wrappers in `listen()`, `addPrompt()`, `addResource()`, and `syncPrimitive()` methods

**Widget Resource Preservation:**

- Widget resources (`ui://widget/*`) and resource templates are now preserved during HMR
- Prevents deletion of widget registrations that are only registered on initial load
- Ensures widgets remain functional across hot reloads

**HMR Sync Behavior:**

- Changed `hmr-sync.ts` to prefer `onUpdate` handler over in-place updates
- Ensures proper handler wrapping for prompts/resources during updates
- Maintains correct order-preserving update behavior

**Content Normalization:**

- Enhanced prompt conversion to handle edge cases:
  - Single content objects without array wrapper
  - Bare content items (result is the content, not wrapped in `content` property)
  - Mixed content type arrays
- Improved robustness of `CallToolResult` to `GetPromptResult` conversion

Commits: 116a3be4 (partial)
