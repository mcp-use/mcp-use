# MCP Apps Conformance Remediation Plan

Status: proposed
Baseline captured: 2026-07-23
Scope: `@mcp-use/inspector` and the shared React MCP Apps host in
`@mcp-use/client`

## Goal

Close verified MCP Apps host-conformance gaps without advertising capabilities
that a particular Inspector surface cannot fulfill. Test the Chat and Tools
surfaces separately because they share a renderer but mount different host
callbacks.

## Evidence boundary

The local conformance run used suite revision
`79f08bc2b8385f7b14ecab4b11a9703be454e073` against the local Inspector. Both
the suite and Inspector ran locally, with requests to Alpic infrastructure
blocked.

| Result | Count | Meaning |
| --- | ---: | --- |
| Pass | 16 | Verified on the tested Tools surface |
| Fail | 12 | Reproducible behavior on the tested Tools surface |
| Skip | 5 | The suite expected a model-backed flow unavailable in that run |
| Unknown | 23 | Catalogue clauses not implemented by the upstream test suite |

The 23 unknown requirements are gaps in the upstream test suite, not confirmed
Inspector failures. The baseline is also surface-specific: a Tools result
cannot establish whether the corresponding Chat callback works.

## Existing Chat behavior

Both surfaces render MCP Apps through `McpAppsViewPanel` and `ViewRenderer`.
Chat additionally supplies a live conversation callback.

- `ui/message` already reaches Chat's normal send pipeline for text and image
  content. Resource and unknown content blocks still need explicit handling.
- `ui/update-model-context` is stored and included in future model requests by
  both client-side and server-side Chat implementations.
- Model context still needs conversation partitioning, widget teardown,
  size limits, untrusted-input treatment, and a representation that is not a
  fabricated user message.
- Tools must not advertise conversation capabilities unless it offers a real
  transition into Chat.

Therefore message and model-context work is verification and hardening, not a
from-scratch implementation.

## Complexity scale

| Size | Expected effort | Typical scope |
| --- | --- | --- |
| XS | Less than half a day | Metadata, policy, or focused tests |
| S | Half to one day | One host behavior |
| M | One to three days | Cross-package behavior or user interaction |
| L | Three to seven days | Conversation or agent integration |
| XL | One to two or more weeks | Security-boundary architecture |

## Ordered roadmap

| Order | Work item | Size | Expected effect |
| ---: | --- | --- | --- |
| 1 | Keep a local regression runner and evidence snapshot | XS | Reproducible results without Alpic infrastructure |
| 2 | Report one package-derived host version | XS | Correct initialization metadata |
| 3 | Derive capabilities from handlers mounted by each surface | XS | No capability theatre |
| 4 | Preserve tool-definition UI metadata when result metadata arrives | XS | Conformance widgets continue rendering |
| 5 | Emit theme colors with `light-dark()` | S | Cover `context/light-dark` |
| 6 | Propagate host-context changes after initialization | S | Cover `context/context-changed` |
| 7 | Emit a sanitized effective-CSP audit event | S | Cover `security/csp-audit-log` |
| 8 | Default to widget-declared CSP | S | Cover CSP construction and no-loosening |
| 9 | Enforce the app/host display-mode intersection | M | Cover unavailable and undeclared modes |
| 10 | Guard app-originated server tool calls by visibility | M | Block model-only tools from apps |
| 11 | Filter app-only server tools out of Chat's model registry | M | Cover `visibility/app-tool-hidden` |
| 12 | Add confirmed file downloads | M | Cover `download-file/confirm` |
| 13 | Verify and complete Chat `ui/message` content handling | M | Convert Tools-only evidence into a Chat result |
| 14 | Harden model-context lifecycle and serialization | M | Cover future-turn and last-wins behavior |
| 15 | Route app sampling through Inspector approval | L | Cover `sampling/create-message` |
| 16 | Register and execute app-provided tools in Chat | L | Cover `app-tools/call` |
| 17 | Move the sandbox proxy to a distinct origin | XL | Cover the critical origin-isolation clause |

Expected effects are directional, not promises. A status changes only after a
fresh isolated run with retained evidence.

## Milestone 0: reproducible, surface-aware evidence

The local runner must:

- accept an explicit `chat` or `tools` surface profile;
- start only local services and block Alpic domains;
- record suite, Inspector, browser, and source revisions;
- retain raw results rather than updating public catalogue data;
- reject duplicate IDs, missing results, and invalid statuses;
- distinguish upstream-unimplemented tests from host failures;
- compare each surface against its own expected baseline.

The Chat profile should use a deterministic fake model so model-dependent
requirements do not require developer credentials or make external requests.

## Milestone 1: truthful host foundations

### Version metadata

Generate initialization host version and host-context user agent from the
Inspector package version. Test that both values agree.

### Capability derivation

Advertise a capability only while its functioning handler is mounted:

- Chat may advertise `message`; Tools may not.
- Model context requires a usable conversation context, not debug storage alone.
- Sampling and downloads require their approval handlers.
- Server tools and resources require a live connection.
- Unsupported invocations return explicit protocol errors.

### Metadata merging

Tool-result metadata augments rather than replaces definition metadata. Preserve
the MCP Apps resource URI and nested UI metadata when a result adds analytics,
tracing, or other unrelated `_meta` fields.

## Milestone 2: bounded protocol and policy work

### Theme and context

- produce valid paired `light-dark()` values;
- set `color-scheme: light dark`;
- emit one context update for a real theme change;
- avoid updates for unrelated renders;
- preserve locale, timezone, safe area, and display mode.

### CSP

- use widget-declared CSP by default;
- keep permissive mode as an explicit debug override;
- log normalized connect, resource, frame, and base-URI domains;
- never log widget HTML, authorization data, tool inputs, or secret query
  strings.

### Display modes

Resolve requests against the intersection of host-supported and app-declared
modes. An unavailable request must leave the UI unchanged and return the
current mode.

### Tool visibility

Enforce visibility in both directions:

- app-originated `tools/call` requires visibility containing `app`;
- Chat's model registry excludes tools visible only to `app`;
- refreshed tool lists replace stale visibility metadata;
- absent metadata follows one documented conservative compatibility rule.

## Milestone 3: user-mediated and Chat behavior

### File downloads

Require confirmation and validate URI, MIME type, size, and filename. Sanitize
filenames, revoke object URLs, expose cancellation, and enforce a conservative
size limit.

### `ui/message`

Test the existing Chat path end to end. Preserve supported text, image, and
resource blocks; surface send failures; and ensure a successful response means
the message actually entered the conversation. Tools must either offer an
explicit “Open in Chat and send” transition or leave the capability
unadvertised.

### Model context

Keep only the latest update for each active widget and conversation. Clear it
on teardown, size-limit it, treat it as untrusted, and pass it to the model
without fabricating a user-authored message. Test client-side and server-side
Chat with a deterministic fake model.

## Milestone 4: agent integration

### Sampling

Connect app `sampling/createMessage` to the existing Inspector sampling approval
flow. Approval, denial, cancellation, and provider failure must be distinct.

### App-provided tools

Register initialized app tools in the active Chat agent, namespaced by widget
instance. Prevent collisions with server and sibling-widget tools, process
list-change notifications atomically, and remove registrations at teardown.

## Milestone 5: isolated sandbox origin

Serve the sandbox proxy from a distinct origin, including a separate localhost
origin or port in development.

Security requirements:

- validate exact `event.source` and `event.origin`;
- bind each view to a nonce or equivalent channel identifier;
- use restrictive CSP and frame-ancestor policy;
- prevent sibling widgets from spoofing messages;
- retain open-link, tools, resources, resize, cancellation, and teardown
  behavior.

The end-to-end acceptance condition is that app access to
`window.top.location` throws a cross-origin exception while the proxy remains
functional.

## Test and release gates

Run:

```text
format
lint
typecheck
unit tests
integration tests
production build
local conformance regression for Tools
local conformance regression for Chat
```

Additionally:

- retain all original verified passes;
- attach evidence to every non-unknown result;
- never convert an upstream-unimplemented clause into an Inspector failure;
- never advertise a capability without a working handler;
- never update a public score from an ad hoc developer run;
- require focused review for security-sensitive changes.
