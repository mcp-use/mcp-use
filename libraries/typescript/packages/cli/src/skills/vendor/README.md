# Vendored YAML parser

`yaml-2.8.3.min.js` contains the `parseDocument` path from
[`yaml` 2.8.3](https://github.com/eemeli/yaml/tree/v2.8.3), bundled from its
browser ESM entry and minified with esbuild. The upstream ISC license is
reproduced in `packages/cli/THIRD_PARTY_NOTICES.md`.

The vendored version includes the fix for GHSA-48c2-rrv3-qjmp, bounds alias
expansion through the upstream `maxAliasCount` protection, and contains no
dynamic code evaluation. Its SHA-256 digest is
`e8afc923424d4a595baaf6444b76b2bc43a2e00192d7a88e8692bf51310ebf3e`.

To refresh it, temporarily install the intended audited `yaml` version and
bundle an entry that re-exports only `parseDocument` using:

```sh
esbuild vendor-yaml-entry.js --bundle --format=esm --platform=browser \
  --target=es2022 --minify --legal-comments=none \
  --outfile=vendor/yaml-<version>.min.js
```
