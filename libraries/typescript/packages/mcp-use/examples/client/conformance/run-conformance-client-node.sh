#!/bin/bash
# Wrapper script for running the TypeScript NODE conformance client.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec npx tsx src/conformance-client-node.ts "$@"
