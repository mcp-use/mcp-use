/**
 * Minimal newline-delimited JSON parser for Ollama streaming responses.
 */

export async function* parseNDJSON(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<unknown, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          yield JSON.parse(trimmed);
        } catch {
          // Ignore malformed partial chunks.
        }
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      try {
        yield JSON.parse(trailing);
      } catch {
        // Ignore malformed trailing chunks.
      }
    }
  } finally {
    reader.releaseLock();
  }
}
