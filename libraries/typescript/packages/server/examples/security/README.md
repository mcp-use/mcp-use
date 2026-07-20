# Host and origin validation

This example demonstrates explicit validation for a server mounted with `getHandler()` (or run through the CLI).

`api.example.com` is accepted as a `Host`, and POST requests from `https://app.example.com` are accepted as an `Origin`. Other values receive `403`; localhost values remain accepted for local development. Replace both example domains with the domains that actually reach your deployment.

```bash
pnpm dev
```
