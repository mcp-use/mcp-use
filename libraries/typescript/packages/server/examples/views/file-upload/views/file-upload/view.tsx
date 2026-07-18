import { type ChangeEvent, useState } from "react";
import { useFiles } from "mcp-use/react";

type UploadState = {
  fileId: string;
  name: string;
  size: number;
};

const panelStyle = {
  display: "grid",
  gap: "1rem",
  padding: "1rem",
  fontFamily: "system-ui, sans-serif",
} as const;

const actionsStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "0.75rem",
} as const;

/** Render ChatGPT file upload and temporary-download-url controls. */
export default function FileUploadView() {
  const { isSupported, upload, getDownloadUrl } = useFiles();
  const [uploaded, setUploaded] = useState<UploadState>();
  const [downloadUrl, setDownloadUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(undefined);
    setDownloadUrl(undefined);

    try {
      const { fileId } = await upload(file);
      setUploaded({ fileId, name: file.name, size: file.size });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function createDownloadLink() {
    if (!uploaded) return;

    setBusy(true);
    setError(undefined);

    try {
      const result = await getDownloadUrl({ fileId: uploaded.fileId });
      setDownloadUrl(result.downloadUrl);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create download URL"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={panelStyle}>
      <header>
        <h2 style={{ margin: 0 }}>Upload a file</h2>
        <p>
          Uploads use ChatGPT&apos;s optional file API. The hook does not update
          widget or model state.
        </p>
      </header>

      {!isSupported && (
        <p role="status">
          File upload is unavailable in this host. Open this app in ChatGPT to
          try it.
        </p>
      )}

      <div style={actionsStyle}>
        <input
          type="file"
          aria-label="Choose a file to upload"
          disabled={!isSupported || busy}
          onChange={(event) => void handleUpload(event)}
        />
        {busy && <span role="status">Working…</span>}
      </div>

      {uploaded && (
        <section>
          <p>
            Uploaded <strong>{uploaded.name}</strong> (
            {uploaded.size.toLocaleString()} bytes)
          </p>
          <div style={actionsStyle}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void createDownloadLink()}
            >
              Create download link
            </button>
            {downloadUrl && (
              <a href={downloadUrl} target="_blank" rel="noreferrer">
                Download {uploaded.name}
              </a>
            )}
          </div>
        </section>
      )}

      {error && <p role="alert">{error}</p>}
    </main>
  );
}
