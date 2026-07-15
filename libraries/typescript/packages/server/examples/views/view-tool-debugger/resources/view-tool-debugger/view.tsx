import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  ThemeProvider,
  ToolError,
  ViewControls,
  useHostContext,
  useToolContext,
  useViewTheme,
  useViewTool,
} from "@mcp-use/server/react";

import "./view.css";

const actionSchema = z.enum([
  "inspect",
  "increment",
  "set-note",
  "return-error",
  "throw-error",
]);

const debugViewToolInputSchema = z.object({
  action: actionSchema.describe("Diagnostic path to exercise"),
  amount: z
    .number()
    .int()
    .optional()
    .describe("Increment amount. Used only by the increment action."),
  note: z
    .string()
    .optional()
    .describe("Replacement note. Used only by the set-note action."),
  requestId: z
    .string()
    .optional()
    .describe("Caller-provided correlation ID echoed in the result and log."),
});

const debugStateSchema = z.object({
  counter: z.number().int(),
  note: z.string(),
  toolEnabled: z.boolean(),
});

const debugViewToolOutputSchema = z.object({
  callId: z.number().int().positive(),
  handledAt: z.string(),
  action: actionSchema,
  received: debugViewToolInputSchema,
  stateBefore: debugStateSchema,
  stateAfter: debugStateSchema,
  renderNumber: z.number().int().positive(),
});

const TOOL_NAME = "debug-view-state";
const DEFAULT_TITLE = "Debug the mounted view state";
const DEFAULT_DESCRIPTION =
  "Inspect or mutate the live React state in the visible useViewTool debugger. Use inspect first; requestId is useful for correlating the host call with the on-screen event log.";

type DebugAction = z.infer<typeof actionSchema>;
type DebugToolInput = z.infer<typeof debugViewToolInputSchema>;
type DebugState = z.infer<typeof debugStateSchema>;

interface DebugEvent {
  id: number;
  at: string;
  type: string;
  data?: unknown;
}

function errorSnapshot(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, candidate: unknown) =>
        candidate instanceof Error ? errorSnapshot(candidate) : candidate,
      2
    );
  } catch (error: unknown) {
    return JSON.stringify(
      {
        serializationError:
          error instanceof Error ? errorSnapshot(error) : String(error),
      },
      null,
      2
    );
  }
}

function JsonPanel({
  title,
  value,
  open = false,
}: {
  title: string;
  value: unknown;
  open?: boolean;
}) {
  return (
    <details className="panel" open={open}>
      <summary>{title}</summary>
      <pre>{formatJson(value)}</pre>
    </details>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <main className="debug-shell">
      <section className="hero">
        <p className="eyebrow">useViewTool diagnostic</p>
        <h1>{message}</h1>
      </section>
    </main>
  );
}

function DebugSession({ initialCounter }: { initialCounter: number }) {
  const view = useToolContext<"open-view-tool-debugger">();
  const host = useHostContext();
  const theme = useViewTheme();

  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const callSequenceRef = useRef(0);
  const eventSequenceRef = useRef(0);

  const [counter, setCounter] = useState(initialCounter);
  const [note, setNote] = useState(
    "Change me locally or through the view tool."
  );
  const [toolEnabled, setToolEnabled] = useState(true);
  const [toolTitle, setToolTitle] = useState(DEFAULT_TITLE);
  const [toolDescription, setToolDescription] = useState(DEFAULT_DESCRIPTION);
  const [lastArgs, setLastArgs] = useState<DebugToolInput | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [events, setEvents] = useState<DebugEvent[]>([]);

  const appendEvent = useCallback((type: string, data?: unknown) => {
    eventSequenceRef.current += 1;
    const event: DebugEvent = {
      id: eventSequenceRef.current,
      at: new Date().toISOString(),
      type,
      ...(data === undefined ? {} : { data }),
    };
    setEvents((current) => [event, ...current].slice(0, 100));
    console.info(`[view-tool-debugger] ${type}`, data ?? "");
  }, []);

  const currentState = (): DebugState => ({
    counter,
    note,
    toolEnabled,
  });

  useViewTool(
    {
      name: TOOL_NAME,
      title: toolTitle,
      description: toolDescription,
      inputSchema: debugViewToolInputSchema,
      outputSchema: debugViewToolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      enabled: toolEnabled,
    },
    async (args) => {
      callSequenceRef.current += 1;
      const callId = callSequenceRef.current;
      const handledAt = new Date().toISOString();
      const stateBefore = currentState();
      setLastArgs(args);
      appendEvent("view-tool/call-received", { callId, args, stateBefore });

      if (args.action === "throw-error") {
        const thrown = new Error(
          `Deliberate throw from ${TOOL_NAME} call ${callId}`
        );
        setLastResult({ threw: errorSnapshot(thrown) });
        appendEvent("view-tool/handler-threw", {
          callId,
          error: errorSnapshot(thrown),
        });
        throw thrown;
      }

      if (args.action === "return-error") {
        const errorResult = {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Deliberate isError result from ${TOOL_NAME} call ${callId}`,
            },
          ],
          _meta: { callId, handledAt, diagnosticPath: "return-error" },
        };
        setLastResult(errorResult);
        appendEvent("view-tool/returned-isError", {
          callId,
          result: errorResult,
        });
        return errorResult;
      }

      let stateAfter = stateBefore;
      if (args.action === "increment") {
        const nextCounter = counter + (args.amount ?? 1);
        stateAfter = { ...stateBefore, counter: nextCounter };
        setCounter(nextCounter);
      } else if (args.action === "set-note") {
        const nextNote = args.note ?? "";
        stateAfter = { ...stateBefore, note: nextNote };
        setNote(nextNote);
      }

      const structuredContent = {
        callId,
        handledAt,
        action: args.action,
        received: args,
        stateBefore,
        stateAfter,
        renderNumber: renderCountRef.current,
      };
      const result = {
        content: [
          {
            type: "text" as const,
            text: `${TOOL_NAME} handled ${args.action} (call ${callId}). Counter: ${stateBefore.counter} -> ${stateAfter.counter}.`,
          },
        ],
        structuredContent,
        _meta: {
          callId,
          ...(args.requestId === undefined
            ? {}
            : { requestId: args.requestId }),
          diagnosticPath: "success",
          note: "View-tool _meta flows back with the tool result.",
        },
      };
      setLastResult(result);
      appendEvent("view-tool/returned-success", { callId, result });
      return result;
    }
  );

  const toolContextSnapshot = {
    status: view.status,
    toolInput: view.toolInput,
    toolOutput: view.status === "ready" ? view.toolOutput : undefined,
    content:
      view.status === "ready" || view.status === "error"
        ? view.content
        : undefined,
    meta:
      view.status === "ready" || view.status === "error"
        ? view.meta
        : undefined,
    reason: view.status === "cancelled" ? view.reason : undefined,
    error: view.status === "error" ? errorSnapshot(view.error) : undefined,
  };
  const hostSnapshot = {
    theme: host.theme,
    locale: host.locale,
    timeZone: host.timeZone,
    userAgent: host.userAgent,
    displayMode: host.displayMode,
    safeArea: host.safeArea,
    maxHeight: host.maxHeight,
    maxWidth: host.maxWidth,
    hostInfo: host.hostInfo,
    hostCapabilities: host.hostCapabilities,
    hostContext: host.hostContext,
    isAvailable: host.isAvailable,
  };
  const definitionSnapshot = {
    name: TOOL_NAME,
    title: toolTitle,
    description: toolDescription,
    enabled: toolEnabled,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      action: actionSchema.options,
      amount: "optional integer",
      note: "optional string",
      requestId: "optional string",
    },
    outputSchema: {
      callId: "positive integer",
      handledAt: "string",
      action: actionSchema.options,
      received: "validated input",
      stateBefore: "DebugState",
      stateAfter: "DebugState",
      renderNumber: "positive integer",
    },
  };
  const stateSnapshot = {
    counter,
    note,
    toolEnabled,
    renderCount: renderCountRef.current,
    callCount: callSequenceRef.current,
    eventCount: events.length,
    theme,
  };
  const toolContextJson = formatJson(toolContextSnapshot);
  const hostJson = formatJson(hostSnapshot);

  useEffect(() => {
    appendEvent("component/mounted", { initialCounter });
    return () => {
      console.info("[view-tool-debugger] component/unmounted");
    };
  }, [appendEvent, initialCounter]);

  useEffect(() => {
    appendEvent("server-tool/context-changed", toolContextSnapshot);
  }, [appendEvent, toolContextJson]);

  useEffect(() => {
    appendEvent("host/context-changed", hostSnapshot);
  }, [appendEvent, hostJson]);

  useEffect(() => {
    appendEvent("view-tool/definition-requested", definitionSnapshot);
  }, [appendEvent, toolEnabled, toolTitle, toolDescription]);

  function changeCounter(delta: number) {
    const before = counter;
    const after = before + delta;
    setCounter(after);
    appendEvent("ui/counter-changed", { before, after, delta });
  }

  function resetLocalState() {
    setCounter(initialCounter);
    setNote("Change me locally or through the view tool.");
    appendEvent("ui/state-reset", { initialCounter });
  }

  return (
    <main className="debug-shell" data-theme={theme}>
      <section className="hero">
        <div>
          <p className="eyebrow">useViewTool diagnostic</p>
          <h1>View Tool Debugger</h1>
          <p className="lede">
            One host tool opens this view. One ephemeral view tool exposes its
            live React state. Every boundary is shown as raw JSON.
          </p>
        </div>
        <div className={`status ${toolEnabled ? "enabled" : "disabled"}`}>
          <span className="status-dot" />
          Hook requested: {toolEnabled ? "enabled" : "disabled"}
        </div>
      </section>

      <section className="callout">
        <strong>Call this from the host/model while the view is open:</strong>
        <code>{`${TOOL_NAME}({ "action": "inspect", "requestId": "first-call" })`}</code>
        <p>
          The view cannot call its own view tool. That tool exists on the
          host/model side of the Apps bridge, so use the host tool UI or ask the
          model to invoke it.
        </p>
      </section>

      <section className="metrics" aria-label="Live metrics">
        <div>
          <span>React renders</span>
          <strong>{renderCountRef.current}</strong>
        </div>
        <div>
          <span>View-tool calls</span>
          <strong>{callSequenceRef.current}</strong>
        </div>
        <div>
          <span>Events retained</span>
          <strong>{events.length}</strong>
        </div>
        <div>
          <span>Bridge</span>
          <strong>{host.isAvailable ? "connected" : "offline"}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="controls-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Latest-closure test</p>
              <h2>Live React state</h2>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={resetLocalState}
            >
              Reset
            </button>
          </div>

          <div className="counter-control">
            <button
              type="button"
              onClick={() => changeCounter(-1)}
              aria-label="Decrement counter"
            >
              −
            </button>
            <output>{counter}</output>
            <button
              type="button"
              onClick={() => changeCounter(1)}
              aria-label="Increment counter"
            >
              +
            </button>
          </div>

          <label>
            <span>Live note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
            />
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={toolEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setToolEnabled(enabled);
                appendEvent("ui/tool-enabled-changed", { enabled });
              }}
            />
            <span>Enable view tool (disable to test list/call behavior)</span>
          </label>

          <label>
            <span>Tool title (updates registration in place)</span>
            <input
              value={toolTitle}
              onChange={(event) => setToolTitle(event.target.value)}
            />
          </label>

          <label>
            <span>Tool description (updates registration in place)</span>
            <textarea
              value={toolDescription}
              onChange={(event) => setToolDescription(event.target.value)}
              rows={4}
            />
          </label>

          <div className="action-reference">
            <h3>Actions to try</h3>
            <ul>
              <li>
                <code>inspect</code> — read the current closure
              </li>
              <li>
                <code>increment</code> — pass an optional integer{" "}
                <code>amount</code>
              </li>
              <li>
                <code>set-note</code> — pass an optional string{" "}
                <code>note</code>
              </li>
              <li>
                <code>return-error</code> — return a deliberate{" "}
                <code>isError</code> result
              </li>
              <li>
                <code>throw-error</code> — throw inside the handler
              </li>
            </ul>
          </div>
        </div>

        <div className="panels">
          <JsonPanel title="Current React state" value={stateSnapshot} open />
          <JsonPanel
            title="Requested view-tool definition"
            value={definitionSnapshot}
            open
          />
          <JsonPanel title="Last handler arguments" value={lastArgs} open />
          <JsonPanel
            title="Last handler result / throw"
            value={lastResult}
            open
          />
          <JsonPanel
            title="Server tool → view context"
            value={toolContextSnapshot}
          />
          <JsonPanel title="Host / bridge context" value={hostSnapshot} />
        </div>
      </section>

      <section className="event-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Newest first · last 100</p>
            <h2>Lifecycle and call log</h2>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => setEvents([])}
          >
            Clear log
          </button>
        </div>
        <div className="event-log">
          {events.length === 0 ? (
            <p className="empty">No events recorded.</p>
          ) : null}
          {events.map((event) => (
            <article className="event" key={event.id}>
              <header>
                <strong>
                  #{event.id} {event.type}
                </strong>
                <time>{event.at}</time>
              </header>
              {event.data === undefined ? null : (
                <pre>{formatJson(event.data)}</pre>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function ViewToolDebuggerContent() {
  const view = useToolContext<"open-view-tool-debugger">();

  if (view.status === "streaming") {
    return <LoadingState message="Receiving partial tool input…" />;
  }
  if (view.status === "pending") {
    return <LoadingState message="Waiting for the server tool result…" />;
  }
  if (view.status === "cancelled") {
    return (
      <LoadingState
        message={`Tool call cancelled${view.reason ? `: ${view.reason}` : "."}`}
      />
    );
  }
  if (view.status === "error") {
    return (
      <LoadingState
        message={`${view.error instanceof ToolError ? "Server tool failed" : "Invalid server tool result"}: ${view.error.message}`}
      />
    );
  }

  return <DebugSession initialCounter={view.toolOutput.initialCounter} />;
}

/**
 * Fully observable useViewTool diagnostic surface.
 */
export default function ViewToolDebugger() {
  return (
    <ThemeProvider>
      <ViewControls debugger viewControls>
        <ViewToolDebuggerContent />
      </ViewControls>
    </ThemeProvider>
  );
}
