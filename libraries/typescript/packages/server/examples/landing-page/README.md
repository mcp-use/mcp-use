# Custom landing page

`landing.tsx` replaces the built-in page that a browser sees at the MCP URL. It reads server data with hooks from `mcp-use/landing` and hydrates in the browser.

```bash
pnpm dev
# open http://localhost:3000/mcp in a browser
```

Things to try:

- Click the install tabs and the copy buttons (they need hydration).
- Edit `landing.tsx`: Fast Refresh keeps the selected tab.
- View the page source: `#mcp-use-landing-data` has `tools` and `prompts`, but no `resources`, because nothing imports `useResourceList`.
- Delete `landing.tsx`: the built-in page comes back.
- `pnpm build && pnpm start` serves the same page from the production build.
