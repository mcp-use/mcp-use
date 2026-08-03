import { useState } from "react";
import {
  ModelContext,
  ThemeProvider,
  ViewControls,
  useCallTool,
  useSendFollowUp,
  useToolContext,
} from "mcp-use/react";

const buttonStyle = {
  border: "1px solid currentColor",
  borderRadius: 8,
  padding: "8px 12px",
  background: "transparent",
  cursor: "pointer",
} as const;

function ChatConformanceContent() {
  const view = useToolContext<"chat-conformance-fixture">();
  const sendFollowUp = useSendFollowUp();
  const helper = useCallTool("chat-conformance-helper");
  const [selection, setSelection] = useState(0);
  const [followUpStatus, setFollowUpStatus] = useState("idle");

  if (view.status !== "ready") {
    return <p>{view.status === "error" ? view.error.message : "Loading…"}</p>;
  }

  return (
    <main
      style={{
        display: "grid",
        gap: 12,
        padding: 20,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <ModelContext content={`Fixture selection is ${selection}`} />
      <h1 style={{ margin: 0, fontSize: 20 }}>Chat conformance fixture</h1>
      <p data-testid="fixture-context-value">Selection: {selection}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => setSelection((value) => value + 1)}
        >
          Update model context
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            setFollowUpStatus("sending");
            void sendFollowUp({
              prompt: `Follow up from fixture selection ${selection}`,
            }).then(
              () => setFollowUpStatus("sent"),
              (error: unknown) =>
                setFollowUpStatus(
                  error instanceof Error ? error.message : String(error)
                )
            );
          }}
        >
          Send follow-up
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={() =>
            void helper.callTool({ value: `selection-${selection}` })
          }
        >
          Call app-only tool
        </button>
      </div>
      <output data-testid="fixture-follow-up-status">{followUpStatus}</output>
      <output data-testid="fixture-helper-status">
        {helper.isPending
          ? "calling"
          : helper.error
            ? helper.error.message
            : helper.data?.content?.[0]?.type === "text"
              ? helper.data.content[0].text
              : "idle"}
      </output>
    </main>
  );
}

export default function ChatConformanceView() {
  return (
    <ThemeProvider>
      <ViewControls debugger>
        <ChatConformanceContent />
      </ViewControls>
    </ThemeProvider>
  );
}
