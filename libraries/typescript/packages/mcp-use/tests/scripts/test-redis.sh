#!/bin/bash
# Run session store tests with Redis using Infisical for environment variables
# Usage: ./tests/scripts/test-redis.sh

set -e

echo "Running session store tests with Redis..."
echo "Loading environment variables from Infisical..."

cd "$(dirname "$0")/../.."

infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- pnpm test tests/unit/server/session-stores.test.ts

echo "✅ Redis session store tests completed!"

