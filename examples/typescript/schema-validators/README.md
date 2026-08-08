# Schema validators

The same `mcp-use` server — a `greet` tool with validated input — built three
times with different schema validators:

- **[arktype](arktype/)**
- **[typebox](typebox/)**
- **[zod](zod/)**

Run any of them from its directory:

```sh
cd zod
npm install
npm run dev
```

Connect to `http://localhost:3000/mcp` and call `greet` with
`{ "name": "Ada" }`.
