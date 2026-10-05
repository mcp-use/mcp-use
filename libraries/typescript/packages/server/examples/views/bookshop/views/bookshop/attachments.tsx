import { useState } from "react";
import { getPublicBaseUrl, useModelContext } from "mcp-use/react";

type ContextBlock = Parameters<ReturnType<typeof useModelContext>["add"]>[1];

/** Read the local illustrated cover as actual PNG content for the model. */
export async function coverContent(
  path: string,
  title: string
): Promise<ContextBlock> {
  const response = await fetch(`${getPublicBaseUrl()}${path}`);
  if (!response.ok)
    throw new Error("Could not load the book cover. Try again.");
  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the book cover."));
    reader.readAsDataURL(blob);
  });
  return {
    type: "image",
    data,
    mimeType: "image/png",
    title: `${title} — cover`,
  };
}

/** Each explicit attachment action owns only its own button's busy/error state. */
export function AttachButton({
  attachmentKey,
  label,
  content,
}: {
  /** Stable key shared by duplicate buttons for the same piece of evidence. */
  attachmentKey: string;
  /** Human-readable action label. */
  label: string;
  /** Construct native content only when the reader chooses to attach it. */
  content: () => ContextBlock | Promise<ContextBlock>;
}) {
  const { add } = useModelContext();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function attach() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await add(attachmentKey, await content());
      setMessage(
        result.status === "synced"
          ? "Last request synced."
          : "A newer change replaced this request."
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add context."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attachment-action">
      <button
        disabled={busy}
        onClick={() => {
          void attach();
        }}
      >
        {busy ? "Adding…" : label}
      </button>
      {message && <small role="status">{message}</small>}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

/** Read reconciled shared attachment state; removals never change the demo cart. */
export function ChatContext() {
  const { attachments, pending, error, remove, clearAttachments, retry } =
    useModelContext();
  const [actionError, setActionError] = useState("");
  async function perform(action: () => Promise<unknown>) {
    setActionError("");
    try {
      await action();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Context update failed."
      );
    }
  }
  return (
    <section className="context-panel" aria-label="Chat context">
      <div className="section-heading">
        <h2>Chat context</h2>
        <span className="badge">{attachments.length}</span>
      </div>
      <p className="muted">
        Choose a cover, book details, or a reading sample to discuss.
      </p>
      {attachments.length > 0 && (
        <ul className="attachment-list">
          {attachments.map(({ key, block }) => {
            const title =
              "title" in block && typeof block.title === "string"
                ? block.title
                : block.type === "resource"
                  ? "text" in block.resource
                    ? block.resource.text.split("\n")[0] || "Reading sample"
                    : "Reading sample"
                  : typeof block._meta?.["openai/title"] === "string"
                    ? block._meta["openai/title"]
                    : "Book context";
            return (
              <li key={key}>
                <span>{title}</span>
                <button
                  className="quiet"
                  aria-label={`Remove ${title}`}
                  onClick={() => {
                    void perform(() => remove(key));
                  }}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pending && <p role="status">Syncing context…</p>}
      {error && (
        <p role="alert">
          Couldn’t sync context. {error.message} Changes may be unsynced.{" "}
          <button
            disabled={pending}
            onClick={() => {
              void perform(retry);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {actionError && actionError !== error?.message && (
        <p role="alert">{actionError}</p>
      )}
      {attachments.length > 0 && (
        <button
          className="quiet"
          onClick={() => {
            void perform(clearAttachments);
          }}
        >
          Clear chat context
        </button>
      )}
    </section>
  );
}
