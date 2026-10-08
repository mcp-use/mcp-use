import { useEffect, useState } from "react";
import { useHostFile, type HostFileData } from "mcp-use/react";

type Draft = { text: string; baseText: string; etag?: string };

function fromText(data: HostFileData): Draft | undefined {
  if (!("text" in data)) return undefined;
  return {
    text: data.text,
    baseText: data.text,
    ...(data.etag && { etag: data.etag }),
  };
}

/** Keep the editable draft and its base ETag separate from live host snapshots. */
export function NoteEditor() {
  const file = useHostFile({ representation: "text", subscribe: true });
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!file.data) return;
    const initial = fromText(file.data);
    if (initial) setDraft((previous) => previous ?? initial);
  }, [file.data]);

  async function save() {
    if (!draft?.etag || !file.canWrite || busy || conflict) return;
    const ifMatch = draft.etag;
    const submitted = draft;
    setBusy(true);
    setMessage("");
    try {
      const result = await file.write({ text: submitted.text }, { ifMatch });
      if (result.outcome === "saved") {
        setDraft({
          text: submitted.text,
          baseText: submitted.text,
          etag: result.etag,
        });
        setMessage("Saved.");
      } else if (result.outcome === "conflict") {
        setConflict(true);
        setMessage(
          "Conflict: the file changed. Your draft is preserved. Check latest, then reload to use the current contents before saving again."
        );
      } else {
        setMessage(
          `Not saved: the host limit is ${result.maxBytes} bytes. Shorten the draft and try again.`
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Save failed. Check latest before trying again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function refresh(replaceDraft: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const current = await file.refresh();
      if (replaceDraft) {
        const next = fromText(current);
        if (next) {
          setDraft(next);
          setConflict(false);
          setMessage("Reloaded the current file. Local edits were discarded.");
        } else
          setMessage(
            "The host returned binary contents; this editor requires text."
          );
      } else
        setMessage(
          "Checked the latest file. Your draft and its original version are preserved."
        );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not refresh. Your draft is preserved."
      );
    } finally {
      setBusy(false);
    }
  }

  if (file.status === "unsupported")
    return (
      <p className="p-6">
        Host file editing is unavailable. Open a demo file in a supporting
        native desktop host.
      </p>
    );
  if (!file.data)
    return (
      <main className="space-y-3 p-6 font-sans">
        <p role={file.error ? "alert" : "status"}>
          {file.error?.message ?? "Reading the opened file…"}
        </p>
        {file.status === "error" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void refresh(false);
            }}
          >
            Retry read
          </button>
        )}
      </main>
    );
  if (!("text" in file.data))
    return (
      <p role="alert" className="p-6">
        The host returned binary contents; this editor requires text.
      </p>
    );
  if (!draft) return <p className="p-6">Preparing text…</p>;

  const changed = draft.etag !== undefined && file.data.etag !== draft.etag;
  const readOnly = !file.data.writable || !draft.etag;
  const disabled = busy || file.isRefreshing;

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 font-sans text-neutral-900 dark:text-neutral-100">
      <header>
        <h1 className="break-all text-xl font-semibold">
          {file.file?.name ?? "Demo note"}
        </h1>
        <p className="mt-1 text-sm">
          {draft.text === draft.baseText
            ? "No local edits."
            : "Unsaved local edits."}
        </p>
      </header>
      {readOnly && (
        <p role="status" className="text-sm">
          Read only: the host has not provided both write permission and a
          version token.
        </p>
      )}
      {changed && (
        <p role="status" className="text-sm">
          The file changed externally. Your draft still uses its original
          version.
        </p>
      )}
      <label className="block">
        <span className="mb-2 block text-sm">Markdown text</span>
        <textarea
          className="min-h-64 w-full rounded-lg border border-neutral-300 p-3 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
          value={draft.text}
          readOnly={readOnly || disabled}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          disabled={disabled || !file.canWrite || !draft.etag || conflict}
          onClick={() => {
            void save();
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="rounded border px-4 py-2 disabled:opacity-50"
          disabled={disabled}
          onClick={() => {
            void refresh(false);
          }}
        >
          Check latest
        </button>
        <button
          type="button"
          className="rounded border px-4 py-2 disabled:opacity-50"
          disabled={disabled}
          onClick={() => {
            void refresh(true);
          }}
        >
          Reload and discard draft
        </button>
      </div>
      <p role="status" className="text-sm">
        {busy ? "Working…" : message}
      </p>
      {file.error && (
        <p role="alert" className="text-sm">
          {file.error.message}
        </p>
      )}
      <p className="text-sm">
        {file.isSubscribed
          ? "Live updates connected."
          : "Use Check latest to read current contents."}
      </p>
      {file.subscriptionError && (
        <p role="status" className="text-sm">
          Live updates unavailable: {file.subscriptionError.message}. Manual
          refresh remains available.
        </p>
      )}
    </main>
  );
}
