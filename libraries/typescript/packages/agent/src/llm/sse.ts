/**
 * Minimal Server-Sent Events parser for provider streaming responses.
 *
 * All three target providers (OpenAI, Anthropic, Google) expose SSE streams
 * over `fetch`. This helper turns the raw `ReadableStream<Uint8Array>` into
 * an async iterable of `{ event, data }` objects. It tolerates CR/LF, blank
 * separator lines, and multi-line `data:` fields.
 */

interface SseEvent {
  event?: string;
  data: string;
}

export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let skipLeadingLF = false;

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      let text = decoder.decode(value, { stream: true });
      if (!text) continue;

      // A CRLF can span decoded chunks, including empty UTF-8 chunks.
      if (skipLeadingLF && text.startsWith("\n")) text = text.slice(1);
      skipLeadingLF = text.endsWith("\r");
      buffer += text.replace(/\r\n?/g, "\n");

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseBlock(raw);
        if (parsed) yield parsed;
      }
    }
    // Flush trailing block if any.
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseSseBlock(raw: string): SseEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? "" : line.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
