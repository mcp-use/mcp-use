# AI IDE Context Files

This directory contains context files to help contributors working with AI-powered IDEs and development tools.

## CLAUDE.md

The `CLAUDE.md` file provides comprehensive guidance for AI assistants (like Claude Code, Cursor, Windsurf, and others) when working with the mcp-use codebase.

### Purpose

We want to make contributing to mcp-use as smooth as possible. Modern AI-powered development tools can significantly boost productivity, but they work best when they understand your codebase's architecture, conventions, and workflows.

By providing this structured context file, we help:
- **New contributors** get up to speed faster with AI assistance
- **AI tools** understand our monorepo structure and development practices
- **Everyone** maintain consistent code quality and architectural patterns

### What's Inside

The CLAUDE.md file includes:
- High-level architecture and design patterns
- Development commands for Python and TypeScript
- Testing strategies and conventions
- Build systems and tooling
- Common development tasks and workflows
- Code style guidelines

### Usage

Most AI-powered IDEs will automatically discover and use files in the `.claude` directory:
- **Claude Code**: Automatically reads `CLAUDE.md` files
- **Cursor**: Supports custom context via `.cursorrules` and can reference this file
- **Windsurf**: Can use context files for better assistance
- **Other AI IDEs**: May support similar conventions

### Language-Specific Context

For additional Python-specific guidance, see:
- `libraries/python/CLAUDE.md`

### Contributing

If you find ways to improve the context provided to AI tools, please submit a PR! Good context helps everyone work more efficiently.
