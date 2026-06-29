#!/usr/bin/env bash
# Publish @mcp-use/inspector CDN artifacts to inspector-cdn.mcp-use.com
#
# Required env (example: Cloudflare R2 via aws cli-compatible endpoint):
#   INSPECTOR_CDN_BUCKET        — bucket name
#   AWS_ACCESS_KEY_ID           — R2 access key
#   AWS_SECRET_ACCESS_KEY       — R2 secret
#   AWS_ENDPOINT_URL            — e.g. https://<account>.r2.cloudflarestorage.com
#
# Usage (from repo root after inspector build):
#   libraries/typescript/packages/inspector/scripts/publish-cdn.sh [version]
#
# Uploads:
#   dist/cdn/inspector.js  → inspector@{version}.js
#   dist/cdn/inspector.css → inspector@{version}.css (optional cache split)
#   public/*               → static assets (providers, favicons)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT/package.json').version")}"

JS="$ROOT/dist/cdn/inspector.js"
CSS="$ROOT/dist/cdn/inspector.css"
PUBLIC="$ROOT/public"

if [[ ! -f "$JS" ]]; then
  echo "Missing $JS — run: pnpm --filter @mcp-use/inspector build" >&2
  exit 1
fi

if [[ -z "${INSPECTOR_CDN_BUCKET:-}" ]]; then
  echo "INSPECTOR_CDN_BUCKET is not set. Dry-run only:" >&2
  echo "  would upload $JS → s3://\$INSPECTOR_CDN_BUCKET/inspector@${VERSION}.js"
  [[ -f "$CSS" ]] && echo "  would upload $CSS → s3://\$INSPECTOR_CDN_BUCKET/inspector@${VERSION}.css"
  [[ -d "$PUBLIC" ]] && echo "  would sync $PUBLIC/ → s3://\$INSPECTOR_CDN_BUCKET/"
  exit 0
fi

upload() {
  local src="$1"
  local dest="$2"
  aws s3 cp "$src" "s3://${INSPECTOR_CDN_BUCKET}/${dest}" \
    --endpoint-url "${AWS_ENDPOINT_URL:?set AWS_ENDPOINT_URL for R2/S3}" \
    --cache-control "public, max-age=31536000, immutable"
  echo "uploaded $dest"
}

upload "$JS" "inspector@${VERSION}.js"
[[ -f "$CSS" ]] && upload "$CSS" "inspector@${VERSION}.css"

if [[ -d "$PUBLIC" ]]; then
  aws s3 sync "$PUBLIC/" "s3://${INSPECTOR_CDN_BUCKET}/" \
    --endpoint-url "${AWS_ENDPOINT_URL}" \
    --cache-control "public, max-age=86400"
  echo "synced public/"
fi

echo "Done. CDN base should serve inspector@${VERSION}.js"
