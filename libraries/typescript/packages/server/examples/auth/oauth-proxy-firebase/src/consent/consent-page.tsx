import type { ConsentPageProps } from "mcp-use/oauth";
import type { ReactNode } from "react";

import { consentStyles } from "./styles.js";

/** The provider that Allow signs in with: the first of `providers` in src/index.ts. */
const PROVIDER = "Google";

/**
 * Consent page in the style of the mcp-use landing page, passed to
 * `oauthProxy` as `consent.page`. The proxy renders it on the server for
 * every sign-in: it is static HTML, so it has no hooks or event handlers.
 *
 * The form contract: post to `form.action`, send `csrf`, and submit
 * `decision` as `allow` or `deny`. With `firebase()`, the proxy adds its
 * sign-in script after the page. A click on the button with
 * `name="decision" value="allow"` opens the Firebase sign-in window, and the
 * script posts the form with the user's tokens when the sign-in succeeds.
 * Sign-in errors appear at the top of the form.
 */
export function ConsentPage(props: ConsentPageProps) {
  const { client, redirectHost, isNative, serverHost, form } = props;
  const appName = client.name ?? client.host ?? "An app";
  // With an in-page upstream such as firebase(), the props also carry
  // `consent`. It is false when the user already approved this app, or
  // consent is off: the page then shows only the sign-in button, because the
  // sign-in window opens only on a click.
  const askConsent = !("consent" in props) || props.consent !== false;
  const title = askConsent
    ? `Allow ${appName} to connect to ${serverHost}?`
    : `Sign in to ${serverHost}`;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{askConsent ? `Allow ${appName}?` : title}</title>
        <style dangerouslySetInnerHTML={{ __html: consentStyles }} />
      </head>
      <body>
        <div className="page">
          <Frame />

          <section className="hero">
            <div className="badges">
              <Badge>{initial(appName)}</Badge>
              <Dots />
              <Badge>
                <FirebaseMark className="provider-mark" />
              </Badge>
            </div>
            <h1>{title}</h1>
            <p className="lead">
              {askConsent
                ? `Allow opens a ${PROVIDER} sign-in window. ${appName} can then use ${serverHost} as you.`
                : `Sign in with ${PROVIDER} to return to ${appName}.`}
            </p>
          </section>

          <section className="card">
            {askConsent && (
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
                <Row label="Signs in with">
                  <span className="value">
                    {PROVIDER}, through Firebase Authentication
                  </span>
                </Row>
              </dl>
            )}

            {askConsent && isNative && (
              <p className="warning">
                This app runs on your computer. Approve only if you started this
                sign-in just now.
              </p>
            )}

            <p className="note">
              Your Firebase sign-in stays on this server. {appName} gets a token
              for {serverHost} only. If your browser asks, allow pop-ups for
              this page.
            </p>

            {/* The sign-in script puts its error messages at the top of the
                form, above the buttons. */}
            <form method="post" action={form.action} className="consent-form">
              <input type="hidden" name="csrf" value={form.csrf} />
              <div className="actions">
                {askConsent && (
                  <button
                    type="submit"
                    name="decision"
                    value="deny"
                    className="button button-secondary"
                  >
                    Deny
                  </button>
                )}
                {/* The sign-in script listens on this button. Keep its name
                    and value. */}
                <button
                  type="submit"
                  name="decision"
                  value="allow"
                  className="button button-primary"
                >
                  {askConsent ? "Allow" : `Continue with ${PROVIDER}`}
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

/** A flame in Firebase's colors. */
function FirebaseMark({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#FFA000" d="M4.5 19.5 7.3 2.4a.5.5 0 0 1 .93-.15L11.6 8.6z" />
      <path fill="#F57C00" d="M13.9 10.4 11.6 6a.5.5 0 0 0-.88 0L4.5 19.5z" />
      <path
        fill="#FFCA28"
        d="m4.5 19.5 11.3-11.2a.5.5 0 0 1 .85.28l2.8 10.92-6.9 3.86a1.4 1.4 0 0 1-1.36 0z"
      />
    </svg>
  );
}
