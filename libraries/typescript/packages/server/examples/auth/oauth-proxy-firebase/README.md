# Firebase OAuth proxy example

Firebase Authentication has no OAuth authorization endpoint, so MCP clients
cannot sign users in with it directly. With `oauthProxy` and `firebase()`, this
server becomes its own OAuth authorization server, and the user signs in with
Firebase on the server's consent page:

1. The MCP client identifies itself with a client ID metadata document, or
   registers through dynamic client registration.
2. The user clicks **Allow** on the consent page. The proxy's script opens the
   Firebase sign-in window (Google in this example) with the Firebase JS SDK.
3. After sign-in, the page posts the user's Firebase ID token and refresh
   token with the decision. The server checks the ID token: its signature,
   the project, the sign-in provider, that the sign-in happened in the last 5
   minutes, and that the email address is verified.
4. The client receives the server's own tokens. The Firebase tokens never
   leave the server, which refreshes the ID token before it expires.

Tools read the user's Firebase ID token with `upstreamToken(ctx)`. The example
has two tools:

- `whoami` returns the Firebase uid, email, and sign-in provider from
  `ctx.auth`.
- `list-notes` reads `users/{uid}/notes` from Firestore with the user's ID
  token, so Firestore applies its security rules to that user.

## Set up Firebase

In the [Firebase console](https://console.firebase.google.com/):

1. Create a project, or open one. In **Project settings** > **General** >
   **Your apps**, add a web app. Copy `apiKey`, `authDomain`, and `projectId`
   from its configuration.
2. In **Authentication** > **Sign-in method**, enable **Google**.
3. In **Authentication** > **Settings** > **Authorized domains**, make sure the
   server's host is listed. `localhost` is there by default. Firebase matches
   subdomains too: `local.mcp-use.run` covers every `pnpm dev --tunnel`
   address.
4. In **Firestore Database**, create a database. Deploy the rules in
   `firestore.rules` (below).

The web API key is not a secret: the sign-in page sends it to the browser.
The server also uses it to refresh ID tokens with the Token Service API. If
you restrict the key in the
[Google Cloud console](https://console.cloud.google.com/apis/credentials):

- Its **API restrictions** must include the **Identity Toolkit API** and the
  **Token Service API**.
- Its **Application restrictions** must not be **HTTP referrers**. The
  server's refresh requests send no referrer, so Google refuses them, and
  tool calls fail once a user's first ID token expires, after an hour.

The proxy needs no client secret: Firebase uses the Google OAuth client of
its own project.

### Security rules

`firestore.rules` lets each user read and write only their own notes:

```text
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/notes/{noteId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Deploy them with the Firebase CLI:

```sh
npx -y firebase-tools@15.33.0 deploy --only firestore:rules --project <project-id>
```

To try `list-notes`, add documents with a `title` and a `text` field to
`users/<uid>/notes`. `whoami` shows the uid.

## Run locally

```sh
cp .env.example .env
```

Set `MCP_USE_FIREBASE_API_KEY`, `MCP_USE_FIREBASE_AUTH_DOMAIN`,
`MCP_USE_FIREBASE_PROJECT_ID`, and `MCP_USE_OAUTH_SECRET`
(`openssl rand -base64 32`). The server keeps sign-ins in Firestore, so it
also needs Google credentials: set `MCP_USE_FIREBASE_SERVICE_ACCOUNT` to a
service account key file (see
[Store sign-ins in Firestore](#store-sign-ins-in-firestore)). If your
organization does not allow service account keys, keep sign-ins in the
Firestore emulator instead: start it with
`npx -y firebase-tools@15.33.0 emulators:start --only firestore --project <project-id>`
and set `MCP_USE_FIRESTORE_EMULATOR_URL=http://127.0.0.1:8080`. Then start the
server:

```sh
pnpm dev
```

Connect an MCP client to `http://localhost:3000/mcp`, for example:

```sh
claude mcp add --transport http firebase-proxy http://localhost:3000/mcp
```

The client opens the consent page. Click **Allow**, and sign in with Google in
the window that opens. If the browser blocks the window, allow pop-ups for the
page and click **Allow** again. Then call `whoami` and `list-notes`.

## Run against the Firebase emulators

The Firebase Local Emulator Suite runs Authentication and Firestore on your
machine, with no Firebase project. `firebase.json` starts the Auth emulator on
port 9099, Firestore on port 8080, and the Emulator UI on port 4000. The
Firestore emulator needs Java 21 or later; the Auth emulator does not.

```sh
npx -y firebase-tools@15.33.0 emulators:start --project demo-mcp-use
```

A `demo-` project ID needs no login and reaches no real project. In `.env`,
use that project ID and point the server at the emulators. The API key and
auth domain can be any value:

```sh
MCP_USE_FIREBASE_API_KEY=demo-api-key
MCP_USE_FIREBASE_AUTH_DOMAIN=demo-mcp-use.firebaseapp.com
MCP_USE_FIREBASE_PROJECT_ID=demo-mcp-use
MCP_USE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
MCP_USE_FIRESTORE_EMULATOR_URL=http://127.0.0.1:8080
```

The server then keeps sign-ins in the Firestore emulator, which needs no
credentials.

Then run `pnpm dev` and connect a client. **Allow** opens the emulator's
sign-in window, where you add an account with made-up details. The Firestore
emulator applies `firestore.rules`, which `firebase.json` names. Add notes in
the Emulator UI at `http://127.0.0.1:4000/firestore`.

The Auth emulator issues ID tokens that are not signed, and with
`MCP_USE_FIREBASE_AUTH_EMULATOR_URL` set the server accepts them: anyone who
can reach the server can sign in as any user. So `oauthProxy` then refuses to
run unless `MCP_URL` is on localhost (and, under `mcp-use start`, the server
listens on a loopback address), and logs a warning. `mcp-use dev` listens on
127.0.0.1 by default; do not pass `--host 0.0.0.0` or open a tunnel while the
emulator is on.
The server never reads `FIREBASE_AUTH_EMULATOR_HOST`. The emulator's sign-in
window loads `https://apis.google.com`, so it needs internet access.

## Store sign-ins in Firestore

`oauthProxy` keeps pending sign-ins, one-time codes, and the users' tokens in
a store. This example keeps them in the project's Firestore, with
`firestoreStorage` from `mcp-use/oauth/storage`:

```ts
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { firestoreStorage } from "mcp-use/oauth/storage";

const app = initializeApp({ projectId, credential: cert(serviceAccountPath) });
const storage = firestoreStorage({ firestore: getFirestore(app) });
```

The store writes one document per key to the `mcp_use_oauth` collection, which
Firestore creates on the first write. The values are encrypted with
`MCP_USE_OAUTH_SECRET`.

- **Credentials.** The store uses `firebase-admin`. On Cloud Run, Cloud
  Functions, and App Hosting it signs in as the service account of the
  runtime, and needs no setting. Elsewhere, create a key in **Project
  settings** > **Service accounts** > **Generate new private key**, keep it
  out of the repository, and set `MCP_USE_FIREBASE_SERVICE_ACCOUNT` to its
  path. A `firebase login` does not give the server credentials.
- **Security rules.** The Admin SDK bypasses security rules. `firestore.rules`
  matches only `users/{uid}/notes`, so no client can read or write
  `mcp_use_oauth`. Keep it that way if you change the rules.
- **Expired documents.** The store ignores expired documents, but Firestore
  keeps them until they are deleted. `firestore.indexes.json` sets a TTL policy
  on `expiresAt` so Firestore deletes them. TTL policies need the Blaze plan:

  ```sh
  npx -y firebase-tools@15.33.0 deploy --only firestore:indexes --project <project-id>
  ```

## Using Firebase from a tool

There are two ways to reach Firebase from a tool.

**The user's ID token over REST (recommended).** Send `upstreamToken(ctx)` as
a bearer token, as `list-notes` does. Firestore and other Firebase services
treat the request as the user's, and your security rules decide what it may
read:

```ts
const response = await fetch(
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/notes`,
  { headers: { authorization: `Bearer ${upstreamToken(ctx)}` } }
);
```

**`firebase-admin` with a service account.** The Admin SDK bypasses security
rules: every request has full access to the project. Scope each query to
`ctx.auth.user.subject`, the uid, yourself:

```ts
import { getFirestore } from "firebase-admin/firestore";

const snapshot = await getFirestore()
  .collection(`users/${ctx.auth.user.subject}/notes`)
  .get();
```

Use it for data that rules cannot express, and keep the service account key
on the server.

## Allow only some clients

Set `MCP_USE_ALLOWED_CLIENTS` to a comma-separated list. Each entry is either
a client ID metadata document URL, which allows that one client, or an HTTPS
origin, which allows every metadata document on that origin:

```sh
MCP_USE_ALLOWED_CLIENTS=https://claude.ai,https://chatgpt.com
```

While it is set, dynamic client registration is off. The list controls which
apps connect, not which Firebase users sign in. See the
[GitHub example](../oauth-proxy-github/README.md#allow-only-some-clients) for
details.

## Custom consent page

The example replaces the built-in consent page with its own:
`src/consent/consent-page.tsx`, passed to `oauthProxy` as `consent.page`.

- The proxy renders the component on the server for each sign-in, with the
  app's name, whether its identity is verified, the client ID, and where the
  browser returns. The component is static HTML: no hooks, no event handlers.
- The page must post a form to `form.action` with the hidden `csrf` input and
  a `decision` button for `allow` and one for `deny`. The proxy adds its
  sign-in script after the page. The script listens on the button with
  `name="decision" value="allow"`: a click opens the sign-in window, and the
  script submits the form when the sign-in succeeds. Sign-in errors appear at
  the top of the form.
- With `firebase()`, the page also receives `consent`. It is `false` when the
  user already approved the app or consent is off. The page then shows only
  the sign-in button, because the sign-in window opens only on a click.
- The page's Content Security Policy runs only scripts with the page's nonce
  and allows inline styles. A custom inline script needs the `nonce` prop.
  The page's CSS is a string in `src/consent/styles.ts`, which the component
  renders into a `<style>` tag.
- Rendering needs `react` and `react-dom` at runtime.

## Connect Claude.ai or ChatGPT

Web clients need a public HTTPS URL, and a public server needs a shared store:

1. Expose the server, for example with `pnpm dev --tunnel` or a deployment.
   The tunnel keeps its subdomain across runs (`.mcp-use/state/tunnel.json`),
   so start it once to learn its URL.
2. Set `MCP_URL` to the public origin, with no path.
3. Add the host of `MCP_URL` to the authorized domains of Firebase
   Authentication.
4. Give the server Google credentials (see
   [Store sign-ins in Firestore](#store-sign-ins-in-firestore)). Every
   instance shares the Firestore store.

Without a shared store and a secret, `oauthProxy` refuses to start outside
localhost: sign-ins, one-time codes, and tokens must be visible to every
instance.

Sign-in uses a pop-up window. It fails where a client opens the consent page
in an embedded web view, which Google refuses for sign-in, and in browsers
that block all third-party storage, such as Safari or Brave with all cookies
blocked.

## Build

```sh
pnpm build
```

`mcp-use build` runs `src/index.ts` to check the server, but it serves no
requests, so it needs none of the settings above. Inside a build,
`isBuilding()` from `mcp-use` returns `true`, and the example's `requireEnv`
skips the check. `firebase()` and `oauthProxy` do not ask for project
settings, a secret, or a store then either. Set the variables where the built
server runs.
