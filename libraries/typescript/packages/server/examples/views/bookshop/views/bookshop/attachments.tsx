import { useEffect, useState } from "react";
import {
  useModelContext,
  type ModelContextOperationResult,
} from "mcp-use/react";

/** Each explicit attachment action owns only its own button's busy/error state. */
export function AttachButton({
  label,
  onAttach,
}: {
  /** Human-readable action label. */
  label: string;
  /** Attach the selected evidence only after the reader clicks. */
  onAttach: () => Promise<ModelContextOperationResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function attach() {
    setBusy(true);
    setError("");
    try {
      await onAttach();
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
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

/** Read reconciled shared attachment state; removals never change the demo cart. */
export function ChatContext() {
  const { attachments, pending, error, remove, clearAttachments } =
    useModelContext();
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    if (pending) setActionError("");
  }, [pending]);
  async function removeAttachment(key: string) {
    setActionError("");
    try {
      await remove(key);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Could not remove context."
      );
    }
  }
  async function clearContext() {
    setActionError("");
    try {
      await clearAttachments();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Could not clear context."
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
            const title = block.title ?? "Book context";
            return (
              <li key={key}>
                <span>{title}</span>
                <button
                  className="quiet"
                  aria-label={`Remove ${title}`}
                  onClick={() => {
                    void removeAttachment(key);
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
          Couldn’t sync context. {error.message} Changes may be unsynced.
        </p>
      )}
      {actionError && actionError !== error?.message && (
        <p role="alert">{actionError}</p>
      )}
      {(attachments.length > 0 || error) && (
        <button
          className="quiet"
          onClick={() => {
            void clearContext();
          }}
        >
          Clear chat context
        </button>
      )}
    </section>
  );
}
