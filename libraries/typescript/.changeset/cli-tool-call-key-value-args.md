---
"@mcp-use/cli": minor
---

feat(cli): accept `key=value` args for `client tools call` and `client prompts get`

Previously the only way to pass arguments to a tool or prompt was a single
JSON-encoded string, which is brittle for both humans (shell escaping) and
agents (extra JSON-stringify step, easy to get wrong). Now each argument is a
variadic positional in `key=value` form, with types coerced from the tool's
input schema (`number`, `integer`, `boolean`, `array`, `object`, `string`,
nullable unions). For nested objects or arrays, `key:=<json>` (httpie-style)
forces the value to be parsed as JSON.

```bash
# Before
mcp-use client tools call greet '{"name":"world","count":3,"enabled":true}'

# After
mcp-use client tools call greet name=world count=3 enabled=true

# Nested values
mcp-use client tools call create-doc title=hello meta:='{"tags":["a","b"]}'
```

The legacy single-JSON-object form is still accepted for backward
compatibility (a single positional starting with `{` is parsed as a JSON
object), and a leading `--` on a key is stripped if present (`--name=world`
works the same as `name=world`). The same syntax applies to
`mcp-use client prompts get`. Error messages now show usage examples and the
target tool's schema so agents can self-correct.
