# View lifecycle & props delivery — decision record

**Status:** decision record, companion to `specs/VIEWS_SPEC.md` (`type_proposals.md` plays the same role for the typing layer). The spec carries the *chosen* design; this document preserves the full option space, the evidence, and the rationale — so that after the alpha ships we can prototype the alternatives against real usage and re-decide with implementation experience instead of re-deriving the analysis. Where a sketch here differs from the spec, the spec wins.

**The question:** how does data reach a view component — who owns the React mount, what are the component's props, and what renders during the pre-result window while tool arguments stream?

## Wire facts (constraints every design lives under)

Verified against ext-apps spec revision `2026-01-26` + `spec.types.ts`:

1. While the model is still generating the tool call, the host MAY stream partial **arguments** to the iframe (`ui/notifications/tool-input-partial`): healed JSON, delivered zero or more times, last array/object item possibly truncated mid-token. Complete arguments follow (`ui/notifications/tool-input`), *then* the host calls `tools/call`.
2. The **result** arrives exactly once (`ui/notifications/tool-result`, a complete `CallToolResult`). There is no partial-result channel; results cannot stream, in any framework, on today's wire.
3. Hosts MAY mount the iframe only when the result is ready — the streaming window does not exist on every host or every render. Anything built for that window is progressive enhancement.
4. The iframe mounts before any data exists. Whatever renders first renders with nothing.

Consequence of (1)+(2): the only way to "stream props" today is the **echo pattern** — put the streamable payload in the *input* schema, echo it into props in the handler. The shipped Excalidraw MCP app ([excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp)) is the existence proof: the drawing is the `elements` argument; the result is just a `checkpointId`. The recipe (and the declare-structured-schema-not-JSON-strings guidance) is now in `VIEWS_SPEC.md` § Streaming.

## The approaches

### A. Hook-pull, component always mounted (v1 mcp-use; Skybridge)

The runtime (or the user's own `mountView(<App />)`) renders the component once, with no props; all tool data arrives later through subscription hooks; the component branches on status itself.

```tsx
function FlightBooking() {
  const { output, isPending } = useToolInfo<"flight-booking">();
  if (isPending) return <Spinner />;          // protocol branch, in every component
  if (!output) return null;                    // output: T | undefined, everywhere
  return <Carousel flights={output.flights} />;
}
```

- Evidence, v1: the generated widget entry does a one-shot `root.render(<Component />)` (`packages/mcp-use/src/server/widgets/mount-widgets-dev.ts`) — hooks were the only channel by which late postMessage data could reach the UI at all. The three-provider transport (window.openai / URL params / MCP Apps) with per-host timing made hooks the least-common-denominator on top of that.
- Evidence, Skybridge: `mountView` receives an already-constructed *element* — structurally cannot inject props (`packages/core/src/web/mount-view.ts`). Every example ships the `isPending` branch. Their `ontoolinputpartial` handler writes partials into the **same store as complete input** with no streaming flag (`bridges/mcp-app/bridge.ts:62–68`) — a view cannot tell healed-partial from complete, and partial data is typed as the full input type.
- Why rejected: the protocol lifecycle leaks into every component's contract (`output: T | undefined` + status branching forever); partial input typed as complete input is a lie; loading UI is re-implemented ad hoc per component. The one genuine virtue — something is always mounted, so continuity is free — is recoverable by other means (see G/H).

### B. v1's merge model (`toolInput` spread into props)

v1 merged `{...toolInput, ...structuredContent}` into `props` on **all** providers (`packages/mcp-use/src/react/useWidget.ts:451–478` — not a ChatGPT-only behavior, contrary to early drafts of the spec). Widgets appeared to have "streaming props" because input fields filled in progressively and output fields overwrote them at result time.

- Why rejected: only coherent when input shape ≈ output shape; fields typed by the output schema could actually be truncated input strings mid-stream; conflates two channels with different types, visibility, and timing. The v2 echo pattern is this behavior reconstructed *explicitly and honestly* for the tools where it makes sense.

### C. Runtime-owned mount, props = result, optional `Loading` export — **chosen (spec default)**

The framework generates the iframe entry; the entry is a stateful wrapper that subscribes to the bridge and renders `<View {...structuredContent} />` when the result arrives. Pre-result, it renders the optional `Loading` export, fed the argument stream (`LoadingProps<Name>` = `{ partialInput?: DeepPartial<Input>; isStreaming: boolean }`); absent `Loading`, nothing (the host's own pending affordance usually covers it — wire fact 3).

- Why chosen: the ready component's contract is pure domain data — complete props, typed from `outputSchema`, destructurable in the signature, no protocol state, trivially testable/reusable (`<View {...mock} />`). Pending UI is a separate render target, mirroring Next.js `loading.tsx` / Suspense fallbacks — the convention agents already know. The streaming window is priced correctly: an export you add only when you want it, costing nothing on hosts that skip the window. Type honesty: `Loading` types from the *input* schema (deep-partial), the view from the *output* schema — the source flip is the point.
- The enabler worth remembering: this is only possible because the **runtime owns the mount** (spec decision 4). A one-shot user-owned mount (A) structurally forces hook-pull.
- Known cost (the live debate): the result-time `Loading` → view swap **unmounts** the streaming phase. Views that build DOM/state during streaming — Excalidraw-class: morphdom-diffed SVG so drawn elements never re-animate, element-count refs, viewport animation, audio — lose everything at exactly the moment they engineered a no-blink transition. The default has no first-class answer; that's approach F's job.

### D. Single component with discriminated-union props, as the *default*

```tsx
export default function View(props:
  | { phase: "streaming"; partialInput?: DeepPartial<Input>; isStreaming: boolean }
  | ({ phase: "ready" } & Output)) { … }
```

- Considered seriously (the "collapse them" debate) and as an external-consult alternative. Honest types, one component, continuity by default, no second export.
- Why rejected *as the default*: (1) kills signature destructuring — `function View({ query, items })` becomes take-whole-and-narrow, i.e. protocol ceremony opening every component ever written; (2) protocol-couples the component — no more `<View {...mock} />` in tests/stories; (3) makes 100% of components carry a branch for a window that often doesn't exist (wire fact 3); (4) component-level precedent runs the other way (`loading.tsx`, Suspense fallback — pending UI as a separate target; TanStack-Query-style status flags are a *hook* idiom, not a component-props contract).
- Still the right *shape* for the opt-in mode (F).

### E. `props: TOutput | undefined` + status prop

- Rejected outright (independently by us and by the GPT 5.5 consult): TypeScript cannot enforce "props exist when ready", so every access pays optional-chaining tax — approach A's ergonomics smuggled into the props model, minus hook-pull's one virtue.

### F. Opt-in single-component "phased" mode — **candidate, tracked in spec Open questions**

Approach D's union props behind an explicit per-view opt-in (marker export `export const viewMode = "phased"`, or a `definePhasedView(...)` wrapper carrying type + runtime marker in one gesture — undecided). The runtime renders both phases at the same tree position, same component type: refs, DOM, and state survive the streaming→ready transition by construction.

- Serves two audiences with one mechanism: continuity-critical generative UIs (Excalidraw could not be built on the default), and authors who simply prefer one component to two exports.
- Open sub-questions: default vs opt-in is settled *for now* (opt-in) but the collapse debate isn't fully closed; marker-export vs wrapper-function; naming ("phased" describes semantics, "single" would describe implementation).

### G. Same-function-as-both-exports continuity trick

`export const Loading = View; export default View` — React preserves the instance when element type and tree position match, so the swap becomes a re-render.

- Rejected **as a documented contract** (GPT 5.5 concurring): relies on users understanding reconciliation identity; silently broken by HMR boundaries, wrapping, `key` changes; props would need an implicit union anyway. Acceptable as the *internal substrate* the phased mode is built on (the wrapper rendering both phases at one position is the same mechanism, owned by us instead of leaked to users).

### H. Collapse the exports, not the contract ("no Loading at all")

Drop the `Loading` export entirely: default = complete-props component that renders nothing pre-result; anything streaming-aware opts into phased (F). One concept total.

- Live middle-ground, not chosen for the alpha: it makes the very common simple-skeleton case take the full union instead of a three-line `Loading` export. Worth re-testing after implementation — if real-world `Loading` exports turn out rare (hosts covering the window; wire fact 3), this becomes attractive.

### I. Suspense-based (`Loading` as fallback, view suspends until result)

- Rejected: the fallback **unmounts** on resolve, so the continuity problem survives untouched; streamed partial input is not "the data being awaited", so it fits Suspense awkwardly; debugging story worse than explicit phases. Fine as a future internal implementation detail; wrong as the public primitive.

## Decision summary

| # | Approach | Verdict |
| --- | --- | --- |
| A | Hook-pull, always mounted (v1/Skybridge) | rejected — protocol leaks into every component |
| B | Merge `toolInput` into props (v1) | rejected — typed lie; replaced by the explicit echo pattern |
| C | Props = result + optional `Loading` export | **chosen default** (spec § Props model / § Streaming) |
| D | Union props as default | rejected as default; right shape for F |
| E | `props?: TOutput` + status | rejected outright |
| F | Opt-in phased single component | candidate — spec Open questions |
| G | Same-function-both-exports | rejected as contract; OK as internal substrate |
| H | No `Loading`; phased is the only alternative | live middle-ground, revisit post-alpha |
| I | Suspense | rejected as public API |

## How to re-evaluate after the alpha (the point of this document)

Concrete experiments, in rough order of information value:

1. **Port the Excalidraw app** to the SDK. This is the acceptance test for F (phased mode): streaming draw-on animation, no remount at result, checkpoint continuation via `useCallTool`. If F can't express it pleasantly, the continuity design is wrong.
2. **Write the template/example views both ways** (C's split vs F's union) and diff the DX: line count, type friction, what an agent generates unprompted when asked to "add a loading state". Agents' priors (Next.js `loading.tsx`) were a load-bearing argument for C — check it empirically.
3. **Count `Loading` exports in real usage.** If almost nobody writes them (hosts covering the pending window), H gets stronger: one component model + one opt-in beats two conventions.
4. **Re-check the wire.** If a partial-result channel lands upstream (tracked in spec Open questions), results become "more prop deliveries" and the streaming-phase question partially dissolves — C was chosen partly because it's forward-compatible with exactly that (generator handlers slot in with no API change).

## Sources & related records

- `specs/VIEWS_SPEC.md` — the chosen contract (§ Props model, § Streaming, Open questions).
- `type_proposals.md` — same decision-record pattern for the typing layer (`ToolRef`/`Register`).
- v1 behavior: `packages/mcp-use/src/react/useWidget.ts` (merge semantics, provider selection), `src/server/widgets/mount-widgets-dev.ts` (one-shot entry).
- Skybridge (hook-pull comparison): [alpic-ai/skybridge](https://github.com/alpic-ai/skybridge) — `packages/core/src/web/mount-view.ts`, `bridges/mcp-app/bridge.ts`, `hooks/use-tool-info.ts`, `examples/flight-booking`.
- Excalidraw MCP app (continuity + echo pattern): [excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp) — `src/mcp-app.tsx` (partial parsing, morphdom, seeds), `src/server.ts` (`create_view`, checkpoint handles).
- External design consult (GPT 5.5): recommended C as default + F as explicit mode; rejected E outright and G as public contract; evaluated and rejected Suspense (I).
