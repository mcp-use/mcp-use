# MCP Events live-validation checklist

Procedure for PLAN.md D73 / WP-40 (H3). Claude runs it through the browser tool
after the maintainer signs in. It answers V1–V18 (PLAN.md §20.1) and fills the
signal matrix (§20.2).

**Rule:** results change data only: rows in
`packages/events-core/src/data/signal-matrix.json`, `KNOWN_CLIENTS` rows and the
docs "Check host support" table. Never code. If a result seems to need a code
change, stop and open an issue.

> TODO(events): confirm against the landed code before the first run: the
> `examples/mcp-events` path and its trigger tool (WP-36), the debug log switch
> and `VERIFY_DELAY_MS` knob of the example, and the pinned MCPJam CLI command.

## 0. Prerequisites (maintainer)

- [ ] A ChatGPT workspace with **Developer mode** and **event-triggered tasks**
      enabled, signed in in the browser profile Claude drives.
- [ ] The candidate build: the pkg.pr.new preview of the `feat/mcp-events → canary`
      PR, or a local `pnpm build` of the candidate SHA. Write the SHA down; it
      goes into `source.run`.
- [ ] Node 22, pnpm 11. No Manufact or cloud credentials are needed (the E20
      repeat against the dev space is a separate step, §18.8.4).

## 1. Server setup

```bash
cd libraries/typescript
pnpm install && pnpm build
cd examples/mcp-events
# Logs every events/* request with headers; the signals land in the
# client_signals log record (once per clientInfo.name per process).
MCP_USE_EVENTS_LOG=debug pnpm exec mcp-use dev --tunnel
```

- [ ] Record the tunnel URL printed by `mcp-use dev` (`https://<sub>.tunnel…/mcp`).
- [ ] Open the Inspector printed by `mcp-use dev`; the Events tab lists the
      example's event types and the health panel shows `sdk.bundled`.
- [ ] Keep the terminal output; each probe below cites the log lines it used.

Start `observations.json` for the run:

```json
{
  "source": { "run": "live-<date>-<sha7>", "date": "<YYYY-MM-DD>" },
  "observations": []
}
```

## 2. ChatGPT probes (V1–V18)

Add the tunnel URL as a connector in ChatGPT (Settings → Connectors → Developer
mode → Create). Create an event-triggered task on one of the example's event
types, then `emit` from the example's trigger tool or the Inspector.

| # | Probe | How to observe | Record as |
|---|---|---|---|
| V1 | Delivery with `webhook-id ≠ eventId` accepted? | Force `compatibility.knownClients` row `webhookId: "random"` for the session, emit, check the task fires | `answers.V1`: `true` if rejected, `false` if accepted |
| V2 | Extension declared? `Mcp-Name`/`Mcp-Method` sent? `clientInfo.name`? | `client_signals` record, request headers in the log | `signals.declaration`, `mcpName`, `mcpMethod`, `clientInfo`; `answers.V2: true` |
| V3 | Events seen with only `extensions` advertised? | Restart with `advertise: "extensions"` forced, reconnect, check subscribe arrives | `answers.V3` |
| V4 | Works end to end on the legacy `initialize` era? | `signals.era`; one emit → task fires | `answers.V4` |
| V5 | `ttlMs` sent and refresh time | `events/subscribe` params; time of the next refresh (keep the task 25 h, or read `health.neverRefreshed`) | `answers.V5: {"ttlMs": n}`, `signals.ttlMs`, `refreshCadenceMs` |
| V6 | Tolerates −3201x codes, `resultType`, unknown fields? | Force an error (unsubscribe an unknown id from the Inspector as the same principal), watch the connector state | `answers.V6`: `false` if it breaks |
| V7 | Subscribe timeout vs synchronous verification | Add a delay to the receiver echo in the example (`VERIFY_DELAY_MS`), bisect until ChatGPT gives up | `answers.V7: {"timeoutMs": n}`, `signals.subscribeTimeoutMs` |
| V8 | User agent, clientInfo, callback host, path shape | Delivery request log | `signals.userAgent`, `callbackHost`, `pathShape`; `answers.V8: true` |
| V9 | Dedupe by `webhook-id` across subscriptions on one host? | Two tasks on the same event type, one emit, count runs | `answers.V9`: `true` if deduped, `false` if both fire |
| V10 | Pause/resume: unsubscribe sent? new URL? cursor null? | Pause then resume the task, read the log | `answers.V10`, `signals.unsubscribeOnPause` |
| V11 | Event scopes in the sign-in challenge avoid `insufficient_scope`? | Run with the example's OAuth profile, `events.scopes.attachToTools` false then true | `answers.V11` |
| V12 | Dot runs missing `data` | Open a dot run, check the payload is visible | `answers.V12`, `signals.notes` |
| V13 | Honours `truncated` on refresh? | Force `truncated:true` on a refresh, observe a catch-up | `answers.V13` |
| V14 | Events on a no-auth connector? | Connector without auth, subscribe | `answers.V14` |
| V15 | Behaviour change with both capability keys on modern? | Compare `advertise: "both"` with `"top"` | `answers.V15`: `true` if it changes |
| V16 | On `mixedAuth`, a 401 on `events/subscribe` starts sign-in? | `mixedAuth` profile, subscribe anonymously | `answers.V16` |
| V17 | Persists and sends back non-null cursors? | Force `replayCursors: true`, refresh, check `cursor` in the next subscribe | `answers.V17`, `signals.sendsCursor` |
| V18 | Uses poll or push? | Any `events/poll` or `events/stream` in the log | `answers.V18`, `signals.modes` |

Each forced setting goes through `compatibility.knownClients` in the example's
config for that run only; revert it before the next probe.

## 3. Other clients

Run the same emit → delivery loop and record one observation per client
(`client`, `profile`, `signals`; `answers` only where a V question applies):

- [ ] **MCPJam** CLI 6.4.3: profiles `draft@28ec35e`, `chatgpt@2026-11-05` and
      the beta grader. `npx @mcpjam/cli@6.4.3 events check <tunnel-url> --profile <p>`.
- [ ] **Inspector v2** (the one `mcp-use dev` opens): Events tab, subscribe in
      webhook, poll and push; declaration on and off.
- [ ] **#3209 client**: the typescript-sdk PR #3209 example client at the
      recorded head SHA, sep webhook, poll and push.
- [ ] **TanStack AI**, **AI SDK**, **Mastra**: their MCP client against the
      tunnel URL; record whether they declare the extension, which modes they
      use, and `clientInfo`.

## 4. Record

```bash
cd libraries/typescript
node e2e/live/record.mjs observations.json            # dry run: merged rows + proposals
node e2e/live/record.mjs observations.json --write    # update signal-matrix.json
pnpm test:events-ci
```

- [ ] Apply the printed `KNOWN_CLIENTS` proposals by hand to the events-core
      data table, one commit, with the run id in the message.
- [ ] Update the docs "Check host support" table from the V4, V11, V14 and V16
      answers.
- [ ] Attach `observations.json` and the terminal log to the PR (the human steps
      of §17.9).

## 5. Repeat on Manufact (E20)

Repeat section 2 against the dev-space deployment URL from the Manufact E2E
harness (§18.8.4) instead of the tunnel, with `source.run` set to the E2E run id.
