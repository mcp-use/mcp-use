#!/bin/bash
# Wrapper script for running the TypeScript BROWSER conformance client.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec npx tsx src/conformance-client-browser.ts "$@"
