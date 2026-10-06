import type { ImageContent } from "@modelcontextprotocol/server";

/** Per-image decoded byte budget, including directly supplied base64. @internal */
export const MAX_CONTEXT_IMAGE_BYTES = 10 * 1024 * 1024;

/** Reject oversized images before retaining or converting their bytes. @internal */
export function assertContextImageSize(bytes: number): void {
  if (bytes > MAX_CONTEXT_IMAGE_BYTES)
    throw new RangeError("Model context images must be at most 10 MiB");
}

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
  const body = response.body;
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_CONTEXT_IMAGE_BYTES) {
    void body?.cancel().catch(() => {});
    assertContextImageSize(declaredSize);
  }
  if (!body) throw new Error("Image response is empty");
  const reader = body.getReader();
  const chunks: string[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      assertContextImageSize(size);
      for (let offset = 0; offset < value.length; offset += 8192)
        chunks.push(
          String.fromCharCode(...value.subarray(offset, offset + 8192))
        );
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("Image response is empty");
  return { type: "image", data: btoa(chunks.join("")), mimeType };
}
