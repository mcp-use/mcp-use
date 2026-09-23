/** HTML pages for the demo's sign-in, consent, and landing routes. */

const style = `
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding-inline: 1rem; }
  code { font-size: 0.9em; }
  label { display: block; margin: 0.25rem 0; }
  button { font: inherit; padding: 0.4rem 0.9rem; margin-right: 0.5rem; }
`;

/** Anonymous sign-in: no credentials, one fresh in-memory user per sign-in. */
export const signInPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in to the mixed OAuth demo</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1>Continue to the mixed OAuth demo</h1>
      <p>This demo uses an anonymous, in-memory account. No credentials are required.</p>
      <button id="sign-in">Continue</button>
      <p id="error" role="alert"></p>
    </main>
    <script>
      const button = document.querySelector('#sign-in');
      const error = document.querySelector('#error');

      button.addEventListener('click', async () => {
        button.disabled = true;
        error.textContent = '';
        try {
          const response = await fetch('/api/auth/sign-in/anonymous', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ oauth_query: location.search.slice(1) }),
          });
          const data = await response.json();
          if (response.ok && data.url) {
            location.replace(data.url);
            return;
          }
          error.textContent = data.message || 'Anonymous sign-in failed';
        } catch (cause) {
          error.textContent = cause instanceof Error ? cause.message : 'Anonymous sign-in failed';
        } finally {
          button.disabled = false;
        }
      });
    </script>
  </body>
</html>`;

/**
 * Consent with one checkbox per requested scope. Unchecking a scope issues a
 * token without it, which is how to test a signed-in caller who lacks a scope.
 */
export const consentPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize the mixed OAuth demo</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1>Authorize the mixed OAuth demo</h1>
      <p>The MCP client is requesting these scopes. Uncheck any you want the token to leave out.</p>
      <form id="consent">
        <fieldset id="scopes"><legend>Requested scopes</legend></fieldset>
        <p>
          <button type="submit" id="allow">Allow selected</button>
          <button type="button" id="deny">Deny</button>
        </p>
      </form>
      <p id="error" role="alert"></p>
    </main>
    <script>
      const query = location.search.slice(1);
      const requested = (new URLSearchParams(query).get('scope') || '')
        .split(' ')
        .filter(Boolean);
      const fieldset = document.querySelector('#scopes');
      const error = document.querySelector('#error');

      if (requested.length === 0) {
        fieldset.append('No scopes were requested.');
      }
      for (const scope of requested) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.name = 'scope';
        box.value = scope;
        box.checked = true;
        label.append(box, ' ', scope);
        fieldset.append(label);
      }

      async function respond(accept) {
        error.textContent = '';
        const scope = [...document.querySelectorAll('input[name=scope]:checked')]
          .map((box) => box.value)
          .join(' ');
        if (accept && requested.length > 0 && scope === '') {
          error.textContent = 'Select at least one scope, or deny.';
          return;
        }
        const response = await fetch('/api/auth/oauth2/consent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            accept,
            ...(accept && scope !== '' && { scope }),
            oauth_query: query,
          }),
        });
        const data = await response.json();
        if (response.ok && data.url) {
          location.href = data.url;
          return;
        }
        error.textContent = data.message || 'Authorization failed';
      }

      document.querySelector('#consent').addEventListener('submit', (event) => {
        event.preventDefault();
        void respond(true);
      });
      document.querySelector('#deny').addEventListener('click', () => {
        void respond(false);
      });
    </script>
  </body>
</html>`;

/** Landing page showing the endpoint and the active baseline scopes. */
export function homePage(options: {
  endpoint: string;
  requiredScopes: readonly string[];
}): string {
  const baseline =
    options.requiredScopes.length > 0
      ? options.requiredScopes.map((scope) => `<code>${scope}</code>`).join(" ")
      : "none";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Mixed OAuth demo</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1>mcp-use mixed OAuth demo</h1>
      <p>MCP endpoint: <code>${options.endpoint}</code></p>
      <p>Required scopes on every sign-in call: ${baseline}</p>
      <p>Items are named for their <code>auth</code>: <code>public_*</code> anyone, <code>optional_*</code> anyone with identity when signed in, <code>protected_*</code> sign-in. See the example README for the full list.</p>
      <p><a href="/mcp/inspector">Open the Inspector</a></p>
    </main>
  </body>
</html>`;
}
