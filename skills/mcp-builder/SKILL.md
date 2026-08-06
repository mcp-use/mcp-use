---
name: mcp-builder
description: Build, modify, debug, or review TypeScript MCP servers with mcp-use.
---

# Build MCP servers with mcp-use

mcp-use is the full stack TypeScript framework for building MCP servers and MCP apps to plug-ins and Claude connectors

Use it to build fully typed MCP servers with tools, resources, prompts, Agent Skills, 1 line oauth authentication adapters, middleware, production transports, a built-in Inspector, and headless tooling.

mcp-use has native first class support for MCP Apps with support for HMR both at the server and MCP App level to live preview the changes on clients like ChatGPT

## Get started

Follow the guides at <https://docs.mcp-use.com/v2>.

## API reference

Consult the TSDoc bundled in the installed package and the TypeScript source
comments on disk. Inspect the project's installed `mcp-use` version and nearby
code before choosing APIs or patterns.

## Agent Skills

When a server needs reusable workflow instructions, prefer the conventional
`skills/<name>/SKILL.md` layout. The directory enables Skills over MCP
automatically, so omit `skills` from `new MCPServer(...)` in the normal case.
Use `skills: false` only to ignore an existing directory, `skills: true` to
require the convention, or `skills: { directory: "server-skills" }` for a
project-relative override. Keep detailed references, scripts, templates, and
assets beside `SKILL.md`; do not copy their contents into tool descriptions or
server instructions.
