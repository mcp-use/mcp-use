# Firebase OAuth proxy example

Firebase Authentication has no OAuth authorization endpoint, so MCP clients
cannot sign users in with it directly. With `oauthProxy` and `firebase()`, this
server becomes its own OAuth authorization server, and the user signs in with
Firebase on the server's consent page:

1. The MCP client identifies itself with a client ID metadata document, or
   registers through dynamic client registration.
2. The user clicks **Allow** on the consent page, which opens the Firebase
   sign-in window (Google in this example).
3. The server checks the user's Firebase ID token and keeps it, with the
   refresh token, in Firestore.
4. The client receives the server's own tokens. The Firebase tokens never
   leave the server, which refreshes the ID token before it expires.

The example has three tools:

- `whoami` returns the Firebase uid, email, and sign-in provider from
  `ctx.auth`.
- `list-notes` and `add-note` read and write the user's notes in Firestore,
  at `users/{uid}/notes`, with the Admin SDK.

The Admin SDK bypasses security rules, so the tools build every path from
`ctx.auth.user.subject`, the verified Firebase uid. `firestore.rules` gives
clients no access at all.

## Run locally

The example runs against the Firebase emulators, with no Firebase project or
credentials. The Firestore emulator needs Java 21 or later.

```sh
npx -y firebase-tools@15.33.0 emulators:start --project demo-mcp-use
```

In another terminal:

```sh
cp .env.example .env   # then set MCP_USE_OAUTH_SECRET: openssl rand -base64 32
pnpm dev
```

Connect an MCP client to `http://localhost:3000/mcp`, for example:

```sh
claude mcp add --transport http firebase-proxy http://localhost:3000/mcp
```

Click **Allow** on the consent page. The emulator's sign-in window opens: add
an account with any name and email. Then call `whoami`, `add-note`, and
`list-notes`. The Emulator UI at `http://127.0.0.1:4000` shows the notes and
the proxy's records.

The Auth emulator issues unsigned ID tokens, so anyone who can reach the server
could sign in as any user. While `MCP_USE_FIREBASE_AUTH_EMULATOR_URL` is set,
`oauthProxy` therefore runs only on localhost. Do not open a tunnel or listen
on `0.0.0.0` with the emulators on.

## Use a real Firebase project

In the [Firebase console](https://console.firebase.google.com/):

1. Add a web app to the project (**Project settings** > **General** > **Your
   apps**) and copy its `apiKey`, `authDomain`, and `projectId` into `.env`.
   Remove the two emulator URLs.
2. In **Authentication** > **Sign-in method**, enable **Google**.
3. In **Authentication** > **Settings** > **Authorized domains**, add the
   server's host. `localhost` is there by default.
4. Create a **Firestore Database**, and deploy this example's rules:

   ```sh
   npx -y firebase-tools@15.33.0 deploy --only firestore:rules --project <project-id>
   ```

The server reaches Firestore with `firebase-admin`, which finds Google
credentials on its own: the service account of the runtime on Cloud Run,
Cloud Functions, or App Hosting, or `gcloud auth application-default login`
on your machine.

The web API key is not a secret, but the server uses it to refresh ID tokens.
If you restrict the key, allow the Identity Toolkit API and the Token Service
API, and do not restrict it to HTTP referrers.

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

## Custom consent page

`src/consent/consent-page.tsx` replaces the built-in consent page, passed to
`oauthProxy` as `consent.page`. The proxy renders it on the server for each
sign-in.

- The page posts a form to `form.action` with the hidden `csrf` input and a
  `decision` button for `allow` and one for `deny`. The proxy's script opens
  the sign-in window when **Allow** is clicked, and submits the form once the
  user is signed in.
- `consent` is `false` when the user already approved the app. The page then
  shows only the sign-in button.
- The page's CSS is a string in `src/consent/styles.ts`, rendered into a
  `<style>` tag. The page's Content Security Policy allows inline styles and
  only scripts with the page's `nonce`.

## Connect Claude.ai or ChatGPT

Web clients need a public HTTPS URL, so use a real Firebase project:

1. Expose the server, for example with `pnpm dev --tunnel` or a deployment.
2. Set `MCP_URL` to the public origin, with no path.
3. Add the host of `MCP_URL` to the authorized domains of Firebase
   Authentication.

Sign-in uses a pop-up window. It fails where a client opens the consent page
in an embedded web view, which Google refuses for sign-in.

## Build

```sh
pnpm build
```

`mcp-use build` runs `src/index.ts` without serving requests, so it needs none
of the settings above. Set them where the built server runs.
