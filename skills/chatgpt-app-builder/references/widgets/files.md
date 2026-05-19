# File Handling in Widgets

Upload and download files from within widgets using the `useFiles` hook.

> **ChatGPT Apps SDK only.** The MCP Apps spec (SEP-1865) has [deferred file handling](https://github.com/modelcontextprotocol/ext-apps/issues/201). MCP Apps clients (Claude, Goose, VS Code) do not support file operations. Always check `isSupported` before calling `upload` or `getDownloadUrl`.

---

## `useFiles` Hook

```tsx
import { useFiles } from "mcp-use/react";

const { upload, getDownloadUrl, isSupported } = useFiles();
```

| Property | Type | Description |
|----------|------|-------------|
| `isSupported` | `boolean` | `true` only in ChatGPT Apps SDK. Always check before calling upload/getDownloadUrl. |
| `upload` | `(file: File, options?) => Promise<FileMetadata>` | Upload a file. Model-visible by default. |
| `getDownloadUrl` | `(file: FileMetadata) => Promise<{ downloadUrl: string }>` | Get a temporary download URL (~5 min). |

`FileMetadata` type: `{ fileId: string }`

---

## Basic Pattern

Always guard with `isSupported`. Render a fallback for MCP Apps clients:

```tsx
import { useFiles, useWidget, McpUseProvider } from "mcp-use/react";
import { useState } from "react";

export default function FileWidget() {
  const { isPending } = useWidget();
  const { upload, getDownloadUrl, isSupported } = useFiles();
  const [fileId, setFileId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  // Renders in MCP Apps clients (Claude, Goose, etc.)
  if (!isSupported) {
    return (
      <McpUseProvider autoSize>
        <p>File operations require ChatGPT Apps SDK.</p>
      </McpUseProvider>
    );
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { fileId } = await upload(file);
    setFileId(fileId);
  }

  async function handleGetLink() {
    if (!fileId) return;
    const { downloadUrl } = await getDownloadUrl({ fileId });
    setDownloadUrl(downloadUrl);
  }

  return (
    <McpUseProvider autoSize>
      <input type="file" onChange={handleUpload} />
      {fileId && <button onClick={handleGetLink}>Get download link</button>}
      {downloadUrl && <a href={downloadUrl} target="_blank">Download</a>}
    </McpUseProvider>
  );
}
```

---

## Model Visibility

By default, uploaded files are tracked in widget state under `imageIds` so ChatGPT includes them in the model's conversation context.

```tsx
// Model-visible (default) — ChatGPT includes the file in context
const { fileId } = await upload(file);

// Private — file is uploaded but model won't see it
const { fileId } = await upload(file, { modelVisible: false });
```

Use `modelVisible: false` when the file is for widget-internal use only (e.g. a reference image the widget processes, a config file the user uploads privately).

When `modelVisible: true` (default), the new `fileId` is appended to `imageIds` in widget state, preserving any existing IDs and other state fields.

---

## Storing fileId for Later

Download URLs are **temporary** (~5 minutes). Store the `fileId`, not the URL:

```tsx
const { state, setState } = useWidget<{ uploadedFileId: string | null }>();

async function handleUpload(file: File) {
  const { fileId } = await upload(file);
  // Persist fileId in widget state so model can reference the upload
  await setState({ uploadedFileId: fileId });
}

async function handleDownload() {
  if (!state?.uploadedFileId) return;
  // Call getDownloadUrl fresh each time — don't cache the URL
  const { downloadUrl } = await getDownloadUrl({ fileId: state.uploadedFileId });
  window.open(downloadUrl, "_blank");
}
```

---

## Error Handling

Both `upload` and `getDownloadUrl` throw if called when `isSupported` is `false`. They also throw on host-level errors (network failure, policy violation):

```tsx
try {
  const { fileId } = await upload(file);
  setFileId(fileId);
} catch (err) {
  console.error("Upload failed:", err);
  setError(err instanceof Error ? err.message : "Upload failed");
}
```

---

## Key Rules

- **Always check `isSupported` first** — render a fallback UI for non-ChatGPT hosts
- **Never cache download URLs** — they expire; call `getDownloadUrl` each time you need one
- **Store `fileId` in widget state** if the user may need to re-download later
- **Use `{ modelVisible: false }`** for files the model should not see
- `upload` + `getDownloadUrl` are only available in ChatGPT Apps SDK — MCP Apps support is deferred

---

## Reference

- Full API reference: https://docs.mcp-use.com/typescript/server/widget-components/usefiles
- Example server: `examples/server/ui/files/`
