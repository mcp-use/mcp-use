# File upload example

Minimal MCP Apps server demonstrating ChatGPT's optional file APIs through
`useFiles()`.

The `open-file-upload` tool opens a view where the user can:

- choose and upload a local file;
- retain the returned `fileId` in local React state; and
- request a temporary download URL for that uploaded file.

The example deliberately does not read or write widget state and does not send
the uploaded file ID through model context. Hosts without the ChatGPT file
extension render an unsupported-state message.

## Run locally

From this directory:

```sh
pnpm install
pnpm dev
```

The MCP endpoint is `http://127.0.0.1:3000/mcp`. Call `open-file-upload` in
ChatGPT to open the view and exercise the host-provided file APIs.

For a production build:

```sh
pnpm build
pnpm start
```

## Typecheck

```sh
pnpm typecheck
```

The workspace `mcp-use` package must be built first so its declarations are
available to the example.
