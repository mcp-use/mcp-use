# Mintlify Starter Kit

Click on `Use this template` to copy the Mintlify starter kit. The starter kit contains examples including

- Guide pages
- Navigation
- Customizations
- API Reference pages
- Use of popular components

### Development

Install the [Mintlify CLI](https://www.npmjs.com/package/mintlify) to preview the documentation changes locally. To install, use the following command

```
npm i -g mintlify
```

Run the following command at the root of your documentation (where docs.json is)

```
mintlify dev
```

## TypeScript API reference

The v2 TypeScript API reference is generated from package TSDoc with TypeDoc.
Run the generator from `libraries/typescript`:

```bash
pnpm docs:api
```

This rebuilds the client declarations TypeDoc needs for cross-package links,
then writes the unified server, client, React, and agent HTML reference to
`libraries/typescript/.typedoc`. The production site is deployed from
`libraries/typescript` using its `vercel.json`.

### Publishing Changes

Install our Github App to auto propagate changes from your repo to your deployment. Changes will be deployed to production automatically after pushing to the default branch. Find the link to install on your dashboard.

#### Troubleshooting

- Mintlify dev isn't running - Run `mintlify install` it'll re-install dependencies.
- Page loads as a 404 - Make sure you are running in a folder with `docs.json`
