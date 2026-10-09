import { useState } from "react";
import {
  ThemeProvider,
  useCallTool,
  useOpenFile,
  useToolContext,
} from "mcp-use/react";

function Notes() {
  const view = useToolContext<"open-notes">();
  const creator = useCallTool("create-demo-file");
  const openFile = useOpenFile();
  const [selectedId, setSelectedId] = useState<
    "welcome" | "packing-list" | "meeting-notes"
  >("welcome");
  const [created, setCreated] = useState<{ path: string; name: string }>();
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState(false);

  if (view.status === "pending") return <p className="p-6">Opening notes…</p>;
  if (view.status === "error")
    return (
      <p role="alert" className="p-6">
        {view.error.message}
      </p>
    );
  const note = view.toolOutput.notes.find((item) => item.id === selectedId);
  if (!note) return <p className="p-6">No notes available.</p>;

  async function create() {
    setMessage("");
    setCreated(undefined);
    try {
      const result = await creator.callTool({
        noteId: selectedId,
      });
      setCreated(result.structuredContent);
      setMessage("Demo copy created. Open it in the host to read and edit.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create a demo file."
      );
    }
  }

  async function open() {
    if (!created) return;
    setOpening(true);
    setMessage("");
    try {
      await openFile({ path: created.path });
      setMessage(
        "Open requested. Select Markdown Notes as the file app if prompted."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Host file opening is unavailable."
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 font-sans text-neutral-900 dark:text-neutral-100">
      <header>
        <h1 className="text-xl font-semibold">Markdown Notes</h1>
        <p className="mt-1 text-sm">
          Mention these notes in the composer, or create a file to edit.
        </p>
      </header>
      <label className="block">
        Sample note
        <select
          className="ml-3 rounded border px-3 py-2 dark:bg-neutral-900"
          value={selectedId}
          disabled={creator.isPending || opening}
          onChange={(event) => {
            const next = view.toolOutput.notes.find(
              (item) => item.id === event.target.value
            );
            if (next) setSelectedId(next.id);
            setCreated(undefined);
            setMessage("");
          }}
        >
          {view.toolOutput.notes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm">{note.description}</p>
      <pre className="whitespace-pre-wrap rounded-xl border border-neutral-300 p-4 text-sm dark:border-neutral-700">
        {note.content}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded border px-4 py-2 disabled:opacity-50"
          disabled={creator.isPending || opening}
          onClick={() => {
            void create();
          }}
        >
          {creator.isPending ? "Creating…" : "Create demo file"}
        </button>
        {created && (
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            disabled={opening || creator.isPending}
            onClick={() => {
              void open();
            }}
          >
            {opening ? "Opening…" : "Open"}
          </button>
        )}
      </div>
      {created && <p className="break-all text-sm">Created: {created.name}</p>}
      <p role="status" className="text-sm">
        {message}
      </p>
    </main>
  );
}

export default function NotesView() {
  return (
    <ThemeProvider>
      <Notes />
    </ThemeProvider>
  );
}
