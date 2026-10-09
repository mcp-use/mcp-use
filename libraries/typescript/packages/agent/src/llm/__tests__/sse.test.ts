import { describe, expect, it } from "vitest";
import { parseSSE } from "../sse.js";

const encoder = new TextEncoder();
const endings = [
  { name: "LF", value: "\n" },
  { name: "CRLF", value: "\r\n" },
  { name: "CR", value: "\r" },
];
const separators = endings.flatMap((first) =>
  endings
    // CR followed by LF is one CRLF line ending, not a blank line.
    .filter((second) => first.name !== "CR" || second.name !== "LF")
    .map((second) => ({
      name: `${first.name} + ${second.name}`,
      line: first.value,
      blank: first.value + second.value,
    }))
);

async function collect(chunks: Uint8Array[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const events = [];
  for await (const event of parseSSE(body)) events.push(event);
  return events;
}

describe.each([
  { name: "whole response", split: false },
  { name: "one-byte chunks", split: true },
])("parseSSE with $name", ({ split }) => {
  it.each(separators)(
    "separates events with $name",
    async ({ line, blank }) => {
      const bytes = encoder.encode(
        ["event: token", "data: Hello 世界", "data: again"].join(line) +
          blank +
          "data: second" +
          blank
      );
      const chunks = split
        ? Array.from(bytes, (byte) => Uint8Array.of(byte))
        : [bytes];

      expect(await collect(chunks)).toEqual([
        { event: "token", data: "Hello 世界\nagain" },
        { event: undefined, data: "second" },
      ]);
    }
  );
});

describe("parseSSE compatibility", () => {
  it("keeps CRLF as one ending across empty decoded chunks", async () => {
    expect(
      await collect([
        encoder.encode("event: token\r"),
        new Uint8Array(),
        encoder.encode("\ndata: hello\r"),
        new Uint8Array(),
        encoder.encode("\n\r"),
        new Uint8Array(),
        encoder.encode("\n"),
      ])
    ).toEqual([{ event: "token", data: "hello" }]);
  });

  it("preserves comments, ignored fields, and data whitespace with mixed endings", async () => {
    expect(
      await collect([
        encoder.encode(
          ": heartbeat\revent: token\r\nignored: field\ndata: first\r\ndata:  second\r\r"
        ),
      ])
    ).toEqual([{ event: "token", data: "first\n second" }]);
  });

  it("preserves the existing trailing-block behavior at EOF", async () => {
    expect(await collect([encoder.encode("data: trailing")])).toEqual([
      { event: undefined, data: "trailing" },
    ]);
  });
});
