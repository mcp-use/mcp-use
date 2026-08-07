# Skills over MCP

This server automatically discovers the adjacent `skills/` directory and
publishes `refunds` and `purchasing` Agent Skills alongside their tools.

```sh
pnpm dev
```

Connect to `http://localhost:3000/mcp`. A Skills-capable host can list
`skill://refunds/SKILL.md` or `skill://purchasing/SKILL.md`, read the relevant
policy and template as MCP resources, then call `refund-order` or
`create-purchase-order` as appropriate.

```sh
pnpm verify
```
