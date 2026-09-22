import type { FirebaseWebConfig } from "./identity.js";

interface PageOptions {
  origin: string;
  basePath: string;
  oauthQuery: string;
}

/** Renders the Google sign-in page for an OAuth authorization request. */
export function renderFirebaseLogin(
  options: PageOptions & { config: FirebaseWebConfig }
): Response {
  return page(
    "Sign in",
    `<h1>Sign in</h1><p>Connect your Google account to continue.</p>
<button id="sign-in" type="button" disabled>Sign in with Google</button>`,
    `${clientSettings(options)}
const button = document.getElementById("sign-in");
try {
  const [{ initializeApp }, {
    initializeAuth, inMemoryPersistence, browserPopupRedirectResolver,
    GoogleAuthProvider, signInWithPopup, signOut
  }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js")
  ]);
  const auth = initializeAuth(initializeApp(${scriptJson(options.config)}), {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver
  });
  button.disabled = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Signing in…";
    let continuation;
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await result.user.getIdToken();
      const refreshToken = result.user.refreshToken;
      const start = await post("/native/start", { provider: "firebase", oauth_query: oauthQuery });
      if (typeof start.csrf !== "string" || !start.csrf) throw new Error();
      const signedIn = await post("/native/sign-in", {
        provider: "firebase", proof: { idToken, refreshToken }, oauth_query: oauthQuery, csrf: start.csrf
      });
      continuation = redirectUrl(signedIn);
    } catch (error) {
      status.textContent = error?.code === "auth/popup-blocked"
        ? "Allow pop-ups for this page, then try again."
        : error?.code === "auth/popup-closed-by-user"
          ? "Sign-in was cancelled. You can try again."
          : "Could not sign in. Please try again.";
    } finally {
      await signOut(auth).catch(() => {});
      button.disabled = false;
    }
    if (continuation) window.location.assign(continuation);
  });
} catch {
  status.textContent = "Sign-in could not load. Reload this page to try again.";
}`,
    new URL(`https://${options.config.authDomain}`).origin
  );
}

/** Renders an explicit Allow/Deny decision for an OAuth authorization request. */
export function renderFirebaseConsent(options: PageOptions): Response {
  const query = new URLSearchParams(options.oauthQuery);
  return page(
    "Allow access?",
    `<h1>Allow access?</h1><p>Review the app requesting access to your account.</p>
<dl><dt>Client ID</dt><dd>${html(query.get("client_id") ?? "")}</dd>
<dt>Requested access</dt><dd>${html(query.get("scope") ?? "No additional access requested.")}</dd>
<dt>Redirect URI</dt><dd>${html(query.get("redirect_uri") ?? "")}</dd></dl>
<div class="actions"><button id="deny" class="secondary" type="button">Deny</button>
<button id="allow" type="button">Allow</button></div>`,
    `${clientSettings(options)}
const buttons = [...document.querySelectorAll("button")];
for (const button of buttons) {
  button.addEventListener("click", async () => {
    buttons.forEach((item) => { item.disabled = true; });
    status.textContent = "Continuing…";
    try {
      const result = await post("/oauth2/consent", {
        accept: button.id === "allow", oauth_query: oauthQuery
      });
      window.location.assign(redirectUrl(result));
    } catch {
      status.textContent = "Could not save your choice. Please try again.";
      buttons.forEach((item) => { item.disabled = false; });
    }
  });
}`
  );
}

function clientSettings(options: PageOptions): string {
  return `const api = ${scriptJson(`${options.origin}${options.basePath}`)};
const oauthQuery = ${scriptJson(options.oauthQuery)};
const status = document.getElementById("status");
async function post(path, body) {
  const response = await fetch(api + path, {
    method: "POST", credentials: "same-origin", mode: "same-origin", redirect: "error",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error();
  return response.json();
}
function redirectUrl(result) {
  if (typeof result?.url !== "string" || !result.url) throw new Error();
  return result.url;
}`;
}

function page(
  title: string,
  content: string,
  script: string,
  firebaseAuthOrigin?: string
): Response {
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))
  );
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'${firebaseAuthOrigin ? " https://www.gstatic.com https://apis.google.com" : ""}`,
    `style-src 'nonce-${nonce}'`,
    `connect-src 'self'${firebaseAuthOrigin ? " https://identitytoolkit.googleapis.com https://securetoken.googleapis.com" : ""}`,
    `frame-src ${firebaseAuthOrigin ?? "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)}</title><style nonce="${nonce}">
:root{font-family:system-ui,sans-serif;color:#17202a;background:#f5f6f8;color-scheme:light}
*{box-sizing:border-box}body{margin:0;padding:24px;min-height:100vh;display:grid;place-items:center}
main{width:100%;max-width:460px;background:white;border:1px solid #dce0e5;border-radius:12px;padding:28px}
h1{font-size:25px;margin:0 0 12px}p{line-height:1.5;color:#4b5563;margin:0 0 24px}
dl{margin:24px 0}dt{font-size:13px;font-weight:650;margin-top:18px}dd{margin:5px 0 0;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}
button{font:inherit;font-weight:600;border:1px solid #17202a;border-radius:7px;padding:11px 16px;background:#17202a;color:white;cursor:pointer}
button:focus-visible{outline:3px solid #6b9fff;outline-offset:3px}button:disabled{opacity:.6;cursor:wait}
.secondary{background:white;color:#17202a}.actions{display:flex;gap:12px;justify-content:flex-end}
#status{margin:18px 0 0;font-size:14px;min-height:21px}noscript{display:block;margin-top:16px}
</style></head><body><main>${content}<p id="status" role="status" aria-live="polite"></p>
<noscript>Enable JavaScript to continue.</noscript></main>
<script type="module" nonce="${nonce}">${script}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": policy,
      },
    }
  );
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
