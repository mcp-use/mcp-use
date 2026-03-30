# Elicitation Demo

Minimal MCP server showing both elicitation modes:

- **Form mode** — `ctx.elicit(message, zodSchema)` — structured input fields
- **URL mode** — `ctx.elicit(message, url)` — opens a page in the browser

## Tools

| Tool | Mode | What it does |
|------|------|-------------|
| `ask-question` | Form | Free-text answer |
| `approve` | Form | Boolean + optional reason |
| `confirm-action` | URL | Opens `/confirm` page with a button |
| `pick-color` | URL | Opens `/pick-color` page with a dropdown |

## Run

```bash
pnpm dev
```

## Test prompt

```
Using ONLY the elicitation-demo MCP server tools: ask me what my name is,
then open the color picker page, then ask me to approve "upgrading to v2".
```
