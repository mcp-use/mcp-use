#!/usr/bin/env node

// This is a forwarding script that allows users to run `mcp-use` CLI commands
// when they install the `mcp-use` package. It forwards to the actual CLI
// implementation in the `@mcp-use/cli` package.

import "@mcp-use/cli/dist/index.js";
