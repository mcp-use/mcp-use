import type {
  ImageFromUrlOptions,
  ModelContextImage,
} from "../types/model-context.js";

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Fetch a PNG, JPEG, GIF, or WebP and return native image evidence.
 *
 * Conversion does not mutate model context. Pass the result to
 * {@link useModelContext}'s `add` when the user still wants to attach it.
 * Browser requests follow normal CORS rules.
 *
 * @param url - Image URL understood by the current environment's fetch API.
 * @param options - Optional display title and request cancellation signal.
 * @returns A typed base64 image block with its original MIME type and title.
 * @throws When fetching, reading, or cancellation fails, or when the response
 *   is unsuccessful, empty, or has a missing or unsupported Content-Type.
 */
export async function imageFromUrl(
  url: string | URL,
  options: ImageFromUrlOptions = {}
): Promise<ModelContextImage> {
  if (options.title !== undefined && !options.title.trim()) {
    throw new TypeError("Image title must be nonempty when supplied");
  }
  const response = await fetch(
    url,
    options.signal ? { signal: options.signal } : undefined
  );
  if (!response.ok) {
    throw new Error(`Could not fetch image: HTTP ${response.status}`);
  }
  const mimeType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType)) {
    throw new TypeError(
      `Unsupported image MIME type: ${mimeType || "missing"}`
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  options.signal?.throwIfAborted();
  if (!bytes.length) throw new Error("Image response is empty");
  // Bound the argument count rather than spreading a potentially large image.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return {
    type: "image",
    data: btoa(chunks.join("")),
    mimeType,
    ...(options.title !== undefined && { title: options.title }),
  };
}
