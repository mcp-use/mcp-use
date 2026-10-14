# Google OAuth proxy example with Firestore

Google OAuth clients have no dynamic client registration, so MCP clients
cannot register with Google directly. With `oauthProxy` and `google()`, this
server becomes its own OAuth authorization server in front of Google, and
keeps its sign-ins and the users' data in a Firebase project's Firestore:

1. The MCP client identifies itself with a client ID metadata document, or
   registers through dynamic client registration.
2. The user approves the server's consent page.
3. The server sends the browser to Google as one OAuth client, and exchanges
   Google's code on the server.
4. The client receives the server's own tokens. The Google client secret and
   the user's Google tokens never leave the server, which refreshes the Google
   token before it expires.

The example has three tools:

- `whoami` returns the Google subject, email, and name from `ctx.auth`.
- `list-notes` and `add-note` read and write the user's notes in Firestore,
  at `users/{subject}/notes`, with the Admin SDK.

The Admin SDK bypasses security rules, so the tools build every path from
`ctx.auth.user.subject`, the verified Google subject. `firestore.rules` gives
clients no access at all.

## Set up the Firebase project

In the [Firebase console](https://console.firebase.google.com/), create a
**Firestore Database**, and deploy this example's rules:

```sh
npx -y firebase-tools@15.33.0 deploy --only firestore:rules --project <project-id>
```

The server reaches Firestore with `firebase-admin`. On Cloud Run, Cloud
Functions, or App Hosting, it uses the runtime's service account. Anywhere
else, generate a key in **Project settings** > **Service accounts** >
**Generate new private key**, save it outside the repository, and set
`MCP_USE_FIREBASE_CREDENTIALS` to its path.

## Create a Google OAuth client

Every Firebase project is a Google Cloud project. In the
[Google Cloud console](https://console.cloud.google.com/apis/credentials) of
that project:

1. Configure the OAuth consent screen if the project has none. While its
   publishing status is **Testing**, only the test users you list can sign in.
2. Choose **Create credentials** > **OAuth client ID**, with the type **Web
   application**.
3. Add `http://localhost:3000/mcp/oauth/callback` as an **Authorized redirect
   URI**. This is the proxy's callback, whichever MCP client signs in: Google
   never sees the client's own redirect URI.

Copy the client ID and the client secret.

## Run locally

```sh
cp .env.example .env
```

Set `MCP_USE_GOOGLE_CLIENT_ID`, `MCP_USE_GOOGLE_CLIENT_SECRET`,
`MCP_USE_FIREBASE_PROJECT_ID`, `MCP_USE_FIREBASE_CREDENTIALS`, and
`MCP_USE_OAUTH_SECRET` (`openssl rand -base64 32`). Then start the server:

```sh
pnpm dev
```

If port 3000 is taken, `mcp-use dev` uses the next free port and prints it.
Google refuses that port's callback URL unless the OAuth client lists it. Free
port 3000, or add the printed port's `/mcp/oauth/callback` URL to the client's
redirect URIs and use that port in the client URL below.

Connect an MCP client to `http://localhost:3000/mcp`, for example:

```sh
claude mcp add --transport http google-proxy http://localhost:3000/mcp
```

The client opens the consent page, then Google. After sign-in, call `whoami`,
`add-note`, and `list-notes`.

## Where sign-ins are stored

The tools and `oauthProxy` share one Firestore:

```ts
const db = getFirestore(initializeApp({ projectId }));

oauthProxy({ storage: firestoreStorage({ firestore: db }) /* … */ });
```

- The proxy's records go to the `mcp_use_oauth` collection, encrypted with
  `MCP_USE_OAUTH_SECRET`. Firestore creates the collection on the first write.
- `firestore.indexes.json` sets a TTL policy on `expiresAt`, so Firestore
  deletes expired records. TTL policies need the Blaze plan.

## Allow only some clients

Set `MCP_USE_ALLOWED_CLIENTS` to a comma-separated list of client ID metadata
document URLs or HTTPS origins. Dynamic client registration is then off. See
the [GitHub example](../oauth-proxy-github/README.md#allow-only-some-clients)
for details.

## Connect Claude.ai or ChatGPT

Web clients need a public HTTPS URL:

1. Expose the server, for example with `pnpm dev --tunnel` or a deployment.
2. Set `MCP_URL` to the public origin, with no path.
3. Add `<MCP_URL>/mcp/oauth/callback` to the OAuth client's authorized
   redirect URIs.

## Build

```sh
pnpm build
```

`mcp-use build` runs `src/index.ts` without serving requests, so it needs none
of the settings above. Set them where the built server runs.
