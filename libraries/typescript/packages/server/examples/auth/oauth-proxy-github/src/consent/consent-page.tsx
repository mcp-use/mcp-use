import type { ConsentPageProps } from "mcp-use/oauth";
import type { ReactNode } from "react";

import { consentStyles } from "./styles.js";

/**
 * Consent page in the style of the mcp-use landing page, passed to
 * `oauthProxy` as `consent.page`. The proxy renders it on the server for
 * every sign-in: it is static HTML, so it has no hooks or event handlers.
 *
 * The form contract: post to `form.action`, send `csrf`, and submit
 * `decision` as `allow` or `deny`.
 */
export function ConsentPage({
  client,
  redirectHost,
  upstream,
  scopes,
  serverHost,
  form,
}: ConsentPageProps) {
  const appName = client.name ?? client.host ?? "An app";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{`Allow ${appName}?`}</title>
        <style>{consentStyles}</style>
      </head>
      <body>
        <div className="page">
          <Frame />

          <section className="hero">
            <div className="badges">
              <Badge>{initial(appName)}</Badge>
              <Dots />
              <Badge>
                <GitHubMark className="provider-mark" />
              </Badge>
            </div>
            <h1>
              Allow {appName} to connect to {serverHost}?
            </h1>
            <p className="lead">
              You will sign in with {upstream}. {appName} can then use{" "}
              {serverHost} as you.
            </p>
          </section>

          <section className="card">
            <dl className="details">
              <Row label="App">
                <div className="app">
                  <span className="app-name">{appName}</span>
                  {client.verified ? (
                    <Pill tone="ok">
                      {client.host !== undefined
                        ? `Published at ${client.host}`
                        : "Configured on this server"}
                    </Pill>
                  ) : (
                    <Pill tone="warn">Unverified: the app named itself</Pill>
                  )}
                </div>
                <code className="client-id">{client.id}</code>
              </Row>
              <Row label="Returns to">
                <code>{redirectHost}</code>
              </Row>
              <Row label={`${upstream} access`}>
                {scopes.length === 0 ? (
                  <span className="muted">Your public profile</span>
                ) : (
                  <ul className="scopes">
                    {scopes.map((scope) => (
                      <li key={scope}>
                        <code>{scope}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
            </dl>

            <p className="note">
              Your {upstream} credentials stay on this server. {appName} gets a
              token for {serverHost} only.
            </p>

            <form method="post" action={form.action} className="consent-form">
              <input type="hidden" name="csrf" value={form.csrf} />
              <div className="actions">
                <button
                  type="submit"
                  name="decision"
                  value="deny"
                  className="button button-secondary"
                >
                  Deny
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="allow"
                  className="button button-primary"
                >
                  Allow
                </button>
              </div>
            </form>
          </section>

          <footer>
            Powered by
            <span className="brand">
              <McpUseLogo />
              mcp-use
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn";
  children: ReactNode;
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}

function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** The landing page's thin rails with a cross mark at each corner. */
function Frame() {
  return (
    <div aria-hidden="true">
      <div className="rail rail-left" />
      <div className="rail rail-right" />
      <div className="rail rail-top" />
      <div className="rail rail-bottom" />
      <Cross className="corner corner-top-left" />
      <Cross className="corner corner-top-right" />
      <Cross className="corner corner-bottom-left" />
      <Cross className="corner corner-bottom-right" />
    </div>
  );
}

function Cross({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 22 21" fill="none">
      <path
        fill="currentColor"
        d="M10.5 4C10.5 7.31371 7.81371 10 4.5 10H0.5V11H4.5C7.81371 11 10.5 13.6863 10.5 17V21H11.5V17C11.5 13.6863 14.1863 11 17.5 11H21.5V10H17.5C14.1863 10 11.5 7.31371 11.5 4V0H10.5V4Z"
      />
    </svg>
  );
}

function McpUseLogo() {
  return (
    <svg viewBox="0 0 500 500" fill="currentColor" aria-hidden="true">
      <path d="M105.933 0C164.437 0.000115889 211.865 47.607 211.865 106.333C211.865 131.828 210.494 158.401 221.068 181.6L228.976 198.947C243.585 230.997 269.266 256.7 301.304 271.336L316.156 278.121C340.143 289.079 367.695 287.335 394.067 287.335C452.572 287.335 500 334.942 500 393.668C500 452.394 452.572 500.001 394.067 500.001C335.563 500.001 288.135 452.394 288.135 393.668C288.135 368.974 289.241 343.275 278.992 320.807L270.587 302.38C255.949 270.289 230.214 244.565 198.118 229.939L180.164 221.758C157.282 211.331 131.078 212.666 105.933 212.666C47.4278 212.666 4.92992e-05 165.059 0 106.333C0 47.607 47.4278 0 105.933 0Z" />
      <circle cx="100.426" cy="399.575" r="100.426" />
      <path d="M500 100.426C500 155.889 455.037 200.851 399.574 200.851C344.11 200.851 299.148 155.889 299.148 100.426C299.148 44.962 344.11 0 399.574 0C455.037 0 500 44.962 500 100.426Z" />
    </svg>
  );
}

function GitHubMark({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
