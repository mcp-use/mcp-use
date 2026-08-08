"use client";

import { useEffect, useState } from "react";
import { cn } from "@/client/lib/utils";
import { useShape } from "@/client/lib/shape-context";

// ─── File thumbnail ───────────────────────────────────────────────────────
// Read-only square preview of a File. Images use object-cover via
// `URL.createObjectURL`; other types (including PDF) show a generic document
// glyph. Self-contained (border + surface + sizing) so it can be reused both
// inside the composer's preview row and to render already-sent attachments in
// a chat transcript.
interface FileThumbnailProps {
  file: File;
  /** Side length of the square thumbnail in pixels. */
  size: number;
  className?: string;
}

function FileIcon({ size }: { size: number }) {
  return (
    <svg
      width={Math.max(16, size * 0.35)}
      height={Math.max(16, size * 0.35)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function FileThumbnail({ file, size, className }: FileThumbnailProps) {
  const shape = useShape();
  const isImage = file.type.startsWith("image/");

  // Create blob URL inside an effect (NOT useMemo) so the cleanup-revoke
  // and the URL-creation stay in sync. In React 18 StrictMode dev, a
  // useMemo-created URL gets revoked by the simulated effect-cleanup but
  // useMemo doesn't re-run on the simulated re-mount (no re-render happens),
  // leaving the DOM with a stale, revoked `blob:` URL — broken image.
  // Putting both in the same effect means the simulated re-mount creates a
  // fresh URL and updates state. The one-frame "before URL" state is
  // covered by the bg-accent (no fallback icon shown for images), so the
  // transition is visually clean.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) {
      // Clear stale state if the `file` prop swaps type on the same mount —
      // otherwise a revoked blob URL would keep winning over the new preview.
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isImage, file]);

  const isPending = isImage && !imageUrl;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-accent border border-border",
        shape.bg,
        className
      )}
      style={{ width: size, height: size }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={file.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : isPending ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-6 h-6 rounded-full border-2 border-border border-t-muted-foreground animate-spin"
            aria-label="Loading preview"
            role="status"
          />
        </div>
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center text-muted-foreground"
          role="img"
          aria-label={file.name}
        >
          <FileIcon size={size} />
        </div>
      )}
    </div>
  );
}

export { FileThumbnail };
