import { describe, it, expect } from "vitest";
import { parseNDJSON } from "@/llm/ndjson";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<unknown[]> {
  const results: unknown[] = [];
  for await (const item of parseNDJSON(stream, signal)) {
    results.push(item);
  }
  return results;
}

describe("parseNDJSON", () => {
  it("parses single complete JSON line", async () => {
    const stream = makeStream(['{"a":1}\n']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }]);
  });

  it("parses multiple JSON lines in a single chunk", async () => {
    const stream = makeStream(['{"a":1}\n{"b":2}\n{"c":3}\n']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("parses JSON split across multiple chunks", async () => {
    const stream = makeStream(['{"a":', "1}\n"]);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }]);
  });

  it("handles trailing JSON without final newline", async () => {
    const stream = makeStream(['{"a":1}']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }]);
  });

  it("skips empty lines between JSON objects", async () => {
    const stream = makeStream(['{"a":1}\n\n\n{"b":2}\n']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips whitespace-only lines", async () => {
    const stream = makeStream(['{"a":1}\n   \n{"b":2}\n']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("silently ignores malformed JSON lines", async () => {
    const stream = makeStream(['{"a":1}\nnot-json\n{"b":2}\n']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("silently ignores malformed trailing content", async () => {
    const stream = makeStream(['{"a":1}\nbroken']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }]);
  });

  it("handles line split at newline boundary across chunks", async () => {
    const stream = makeStream(['{"a":1}', "\n", '{"b":2}\n']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("handles many small single-character chunks", async () => {
    const json = '{"x":42}\n';
    const stream = makeStream(json.split(""));
    const results = await collect(stream);
    expect(results).toEqual([{ x: 42 }]);
  });

  it("returns empty array for empty stream", async () => {
    const stream = makeStream([]);
    const results = await collect(stream);
    expect(results).toEqual([]);
  });

  it("returns empty array for stream with only whitespace", async () => {
    const stream = makeStream(["  \n  \n  "]);
    const results = await collect(stream);
    expect(results).toEqual([]);
  });

  it("parses string, number, boolean, null, and array JSON values", async () => {
    const stream = makeStream([
      '"hello"\n',
      "42\n",
      "true\n",
      "null\n",
      "[1,2,3]\n",
    ]);
    const results = await collect(stream);
    expect(results).toEqual(["hello", 42, true, null, [1, 2, 3]]);
  });

  it("handles CRLF line endings", async () => {
    const stream = makeStream(['{"a":1}\r\n{"b":2}\r\n']);
    const results = await collect(stream);
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("parses deeply nested JSON objects", async () => {
    const deep = { level1: { level2: { level3: { value: "deep" } } } };
    const stream = makeStream([JSON.stringify(deep) + "\n"]);
    const results = await collect(stream);
    expect(results).toEqual([deep]);
  });

  it("parses JSON with unicode content", async () => {
    const stream = makeStream(['{"greeting":"héllo wörld","icon":"✅"}\n']);
    const results = await collect(stream);
    expect(results).toEqual([{ greeting: "héllo wörld", icon: "✅" }]);
  });

  it("stops yielding when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = makeStream(['{"a":1}\n{"b":2}\n']);
    const results = await collect(stream, controller.signal);
    expect(results).toEqual([]);
  });

  it("handles streaming response chunks", async () => {
    const chunks = [
      '{"model":"gpt-oss:20b","message":{"role":"assistant","content":"Hello"},"done":false}\n',
      '{"model":"gpt-oss:20b","message":{"role":"assistant","content":" world"},"done":false}\n',
      '{"model":"gpt-oss:20b","message":{"role":"assistant","content":""},"done":true}\n',
    ];
    const stream = makeStream(chunks);
    const results = await collect(stream);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      model: "gpt-oss:20b",
      message: { role: "assistant", content: "Hello" },
      done: false,
    });
    expect(results[2]).toMatchObject({ done: true });
  });

  it("handles tool call response", async () => {
    const toolCallChunk = JSON.stringify({
      model: "gpt-oss:20b",
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "get_weather",
              arguments: { location: "London" },
            },
          },
        ],
      },
      done: true,
    });
    const stream = makeStream([toolCallChunk + "\n"]);
    const results = await collect(stream);

    expect(results).toHaveLength(1);
    const result = results[0] as {
      message: { tool_calls: { function: { name: string } }[] };
    };
    expect(result.message.tool_calls[0].function.name).toBe("get_weather");
  });

  it("handles partial JSON split mid-object across multiple chunks", async () => {
    const obj = { key: "a".repeat(100), nested: { deep: true } };
    const json = JSON.stringify(obj) + "\n";
    const mid = Math.floor(json.length / 3);
    const stream = makeStream([
      json.slice(0, mid),
      json.slice(mid, mid * 2),
      json.slice(mid * 2),
    ]);
    const results = await collect(stream);
    expect(results).toEqual([obj]);
  });

  it("handles mixed valid and invalid lines", async () => {
    const stream = makeStream([
      '{"status":"loading"}\n',
      "partial-data-here\n",
      '{"status":"ready","data":[1,2,3]}\n',
      "\n",
      "another-bad-line\n",
      '{"status":"done"}\n',
    ]);
    const results = await collect(stream);
    expect(results).toEqual([
      { status: "loading" },
      { status: "ready", data: [1, 2, 3] },
      { status: "done" },
    ]);
  });

  it("releases the reader lock after iteration completes", async () => {
    const stream = makeStream(['{"a":1}\n']);
    await collect(stream);
    const reader = stream.getReader();
    const { done } = await reader.read();
    expect(done).toBe(true);
    reader.releaseLock();
  });

  it("releases the reader lock when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = makeStream(['{"a":1}\n']);
    await collect(stream, controller.signal);
    const reader = stream.getReader();
    const { value, done } = await reader.read();
    if (!done) {
      expect(value).toBeInstanceOf(Uint8Array);
    }
    reader.releaseLock();
  });
});
