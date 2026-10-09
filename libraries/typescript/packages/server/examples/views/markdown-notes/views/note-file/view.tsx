import { useEffect } from "react";
import { ThemeProvider, useCallTool, useToolContext } from "mcp-use/react";

import { NoteEditor } from "./editor.js";

function FileEntry() {
  const view = useToolContext<"open-note-file">();
  const check = useCallTool("check-demo-file");
  const { callTool } = check;

  useEffect(() => {
    if (view.status === "ready") void callTool({}).catch(() => {});
  }, [view.status, callTool]);

  if (view.status === "error")
    return (
      <p role="alert" className="p-6">
        {view.error.message}
      </p>
    );
  if (
    view.status === "pending" ||
    check.isPending ||
    (!check.data && !check.error)
  ) {
    return (
      <p className="p-6" role="status">
        Checking demo file…
      </p>
    );
  }
  if (check.error || !check.data?.structuredContent.allowed) {
    return (
      <main className="space-y-3 p-6 font-sans">
        <p role="alert">
          {check.error?.message ?? check.data?.structuredContent.message}
        </p>
        <button
          type="button"
          className="rounded border px-4 py-2"
          onClick={() => {
            void callTool({}).catch(() => {});
          }}
        >
          Check again
        </button>
      </main>
    );
  }

  // Mount the host-file hook only after server-side demo-directory validation.
  return <NoteEditor />;
}

export default function NoteFileView() {
  return (
    <ThemeProvider>
      <FileEntry />
    </ThemeProvider>
  );
}
