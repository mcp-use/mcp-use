import type { ImageContent } from "@modelcontextprotocol/server";

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Fetch supported native image bytes; never changes selection. @internal */
export async function fetchContextImage(
  src: string,
  signal: AbortSignal
): Promise<ImageContent> {
  const response = await fetch(src, { signal });
  if (!response.ok)
    throw new Error(`Could not fetch image: HTTP ${response.status}`);
  const mimeType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType))
    throw new TypeError(
      `Unsupported image MIME type: ${mimeType || "missing"}`
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  if (!bytes.length) throw new Error("Image response is empty");
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return { type: "image", data: btoa(chunks.join("")), mimeType };
}
