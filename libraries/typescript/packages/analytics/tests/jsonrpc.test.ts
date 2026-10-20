import { readResponses, requestMessages } from "../src/adapters/jsonrpc.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(response: Response, done = () => false) {
  const seen: unknown[] = [];
  await readResponses(response, (message) => seen.push(message), done);
  return seen;
}

describe("requestMessages", () => {
  it("keeps requests and drops notifications and responses", () => {
    expect(
      requestMessages([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, result: {} },
        "junk",
      ])
    ).toEqual([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    expect(
      requestMessages({ jsonrpc: "2.0", id: "a", method: "ping" })
    ).toHaveLength(1);
    expect(requestMessages(undefined)).toEqual([]);
  });
});

describe("readResponses", () => {
  it("reads JSON bodies, single or batched", async () => {
    expect(
      await collect(
        Response.json({ jsonrpc: "2.0", id: 1, result: { ok: true } })
      )
    ).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
    expect(
      await collect(
        Response.json([
          { jsonrpc: "2.0", id: 1, result: {} },
          { jsonrpc: "2.0", id: 2, error: { code: -32601, message: "nope" } },
        ])
      )
    ).toHaveLength(2);
  });

  it("reads SSE events split across chunks and skips notifications", async () => {
    const response = new Response(
      streamOf([
        ": keep-alive\n\n",
        'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n',
        'event: message\r\ndata: {"jsonrpc":"2.0",',
        '"id":7,"result":{"content":[]}}\r\n\r\n',
      ]),
      { headers: { "content-type": "text/event-stream" } }
    );
    expect(await collect(response)).toEqual([
      { jsonrpc: "2.0", id: 7, result: { content: [] } },
    ]);
  });

  it("stops reading once done() is true", async () => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(
          new TextEncoder().encode(
            `data: {"jsonrpc":"2.0","id":${reads},"result":{}}\n\n`
          )
        );
      },
    });
    const seen: unknown[] = [];
    await readResponses(
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
      (message) => seen.push(message),
      () => seen.length >= 2
    );
    expect(seen).toHaveLength(2);
  });

  it("ignores bodies that are not JSON-RPC", async () => {
    expect(
      await collect(new Response("<html>oops</html>", { status: 502 }))
    ).toEqual([]);
    expect(await collect(new Response(null, { status: 204 }))).toEqual([]);
  });
});
