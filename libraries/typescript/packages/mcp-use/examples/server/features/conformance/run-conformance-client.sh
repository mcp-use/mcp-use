#!/bin/bash
# Wrapper script for running the TypeScript conformance client.
# The conformance test framework appends the server URL as an argument.
# npx tsx needs a shell wrapper when args are appended by the test framework.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec npx tsx src/conformance-client.ts "$@"
