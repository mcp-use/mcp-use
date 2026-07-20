/**
 * The executable contract for every server example.
 *
 * `verify-examples.mjs` uses this registry rather than discovering directories
 * so adding an example requires declaring how it is verified. Local examples
 * are started and exercised over HTTP by @mcp-use/client. Integration examples
 * intentionally stop at build/type/config validation until test credentials
 * and tenants are available in CI.
 */
export const examples = [
  // Core V2 patterns.
  local("basic", {
    tools: ["greet"],
    resources: ["example://about"],
    prompts: ["introduce"],
    scenario: "basic",
  }),
  local("middleware", {
    tools: ["echo"],
    scenario: "middleware",
    headers: { "x-example-access": "allow" },
  }),
  local("notifications", {
    tools: ["publish-changes"],
    resources: ["example://status"],
    scenario: "notifications",
  }),
  local("sampling", { tools: ["explain-sampling"], scenario: "sampling" }),
  local("sessionless-lifecycle", { tools: ["request-info"] }),
  local("security", { tools: ["status"], scenario: "security" }),
  local("nextjs", {
    tools: ["greet", "show-status-card"],
    endpoint: "/api/mcp",
    launch: "nextjs",
    scenario: "nextjs",
    view: true,
  }),
  local("nextjs-standalone", {
    tools: ["project-status"],
    launch: "nextjs-standalone",
    scenario: "nextjs-standalone",
    view: true,
  }),
  local("public-landing", { tools: ["greet"], landing: true }),
  local("events", {
    tools: ["ping", "recent-events"],
    resources: ["events://observations"],
    scenario: "events",
    headers: { "x-example-request-id": "example-verifier" },
  }),

  // Existing server examples.
  local("conformance", { tools: ["test_simple_text"] }),
  local("elicitation", { tools: ["deploy"] }),
  local("proxy", { tools: ["gateway_status"], launch: "direct" }),
  local("railway", { tools: ["roll-dice"], resources: ["config://about"] }),
  local("resource-template-completion", {
    resourceTemplates: ["repository-file"],
  }),
  local("views/basic", { tools: ["search-fruits"], view: true }),
  local("views/excalidraw", { view: true }),
  local("views/file-upload", { view: true }),
  local("views/story-writer", { view: true }),
  local("views/tic-tac-toe", { view: true }),

  // These are runnable projects when credentials are supplied. Live providers
  // are deliberately not contacted by this suite yet.
  external("auth/auth0"),
  external("auth/better-auth"),
  external("auth/clerk"),
  external("auth/keycloak"),
  external("auth/supabase"),
  external("auth/workos"),
  configuration(
    "openapi",
    "Loads the live weather.gov OpenAPI document; deterministic fixture coverage is deferred."
  ),
  configuration(
    "vercel",
    "A serverless handler example has no local listener; deployment smoke coverage is deferred."
  ),
];

function local(directory, assertions = {}) {
  return {
    id: directory.replaceAll("/", "-"),
    directory,
    verification: "client",
    ...assertions,
  };
}

function external(directory) {
  return {
    id: directory.replaceAll("/", "-"),
    directory,
    verification: "configuration",
    skippedLiveReason:
      "Requires provider or deployment credentials; live integration checks are intentionally deferred.",
  };
}

function configuration(directory, skippedLiveReason) {
  return {
    id: directory.replaceAll("/", "-"),
    directory,
    verification: "configuration",
    skippedLiveReason,
  };
}
