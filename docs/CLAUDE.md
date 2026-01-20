# Documentation Guidelines

This directory contains the mcp-use documentation, built with [Mintlify](https://mintlify.com).

## Improving Documentation

When improving documentation, follow this iterative process:

### 1. Read as a developer
Put yourself in the shoes of a developer who:
- Wants to accomplish a specific task quickly
- Is looking for a specific piece of information
- Is trying to understand how something works

### 2. Identify issues
- Can they find what they need quickly?
- Is the flow logical?
- Are examples complete (imports, realistic values)?
- Is anything confusing or missing?

### 3. Improve and iterate
Rewrite addressing the issues. Then read your changes as a fresh developer. If issues remain, iterate.

### 4. Keep it practical
- **Concise** - No unnecessary words
- **Copy-paste ready** - Examples work as-is
- **Scannable** - Tables, headers, bullet points
- **Complete** - Include imports, handle edge cases

---

## Mintlify Components

Use these components when they add clarity. Reference: https://mintlify.com/docs/components

| Component | When to use |
|-----------|-------------|
| `<Tabs>` | 2-4 related alternatives (languages, approaches) |
| `<Note>` | Important info the reader must not miss |
| `<Tip>` | Best practices, helpful advice |
| `<Warning>` | Pitfalls, breaking changes |
| `<Info>` | Additional context |
| `<Card>` | Links to resources |
| `<Accordion>` | Optional details that would clutter the flow |
| `<Steps>` | Sequential procedures |
| `<CodeGroup>` | Same code in multiple languages |

### Example syntax

```mdx
<Tabs>
  <Tab title="Option A">
    Content A
  </Tab>
  <Tab title="Option B">
    Content B
  </Tab>
</Tabs>

<Tip>
Helpful advice here.
</Tip>

<Note>
Important information here.
</Note>

<Card title="Full Example" icon="github" href="https://github.com/...">
  Description of the linked resource.
</Card>

<AccordionGroup>
  <Accordion title="Advanced details">
    Content that's optional but useful.
  </Accordion>
</AccordionGroup>
```

### Guidelines

- **Don't overuse** - Plain markdown is often clearer
- **Tabs for 2-4 items** - More gets unwieldy
- **Callouts should be rare** - If everything is highlighted, nothing is
- **Complete examples** - Always include imports

---

## File structure

```
docs/
├── docs.json          # Navigation and site config
├── python/            # Python library docs
│   ├── quickstart.mdx
│   ├── api-reference/ # Auto-generated API docs
│   └── ...
├── typescript/        # TypeScript library docs
└── home/              # Landing pages
```

## Regenerating API docs

```bash
cd docs
python generate_docs.py ../libraries/python/mcp_use python/api-reference docs.json
```
