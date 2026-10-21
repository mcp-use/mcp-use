import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchContextImage } from "../src/react/runtime/model-context-image.js";
import { normalizeContextInput } from "../src/react/runtime/model-context-wire.js";

afterEach(() => vi.unstubAllGlobals());

describe("fetchContextImage", () => {
  it("accepts exactly the decoded-byte budget and rejects one byte beyond it", () => {
    const input = {
      type: "image" as const,
      mimeType: "image/png",
      data: Buffer.alloc(10 * 1024 * 1024).toString("base64"),
    };
    expect(normalizeContextInput(input).block).toEqual(input);
    expect(() =>
      normalizeContextInput({
        ...input,
        data: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
      })
    ).toThrow("10 MiB");
  });
  it("rejects declared oversized images before reading their bytes", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(10 * 1024 * 1024 + 1),
          },
        })
      )
    );
    const result = fetchContextImage(
      "https://example.com/large",
      new AbortController().signal
    );
    await expect(result).rejects.toThrow("10 MiB");
    expect(cancel).toHaveBeenCalled();
  });

  it("stops oversized streams even when no length is advertised", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks++ === 12) controller.close();
        else controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, { headers: { "Content-Type": "image/png" } })
        )
    );
    await expect(
      fetchContextImage(
        "https://example.com/large",
        new AbortController().signal
      )
    ).rejects.toThrow("10 MiB");
    expect(cancel).toHaveBeenCalled();
    expect(chunks).toBeLessThanOrEqual(12);
  });

  it.each(["image/png", "image/jpeg", "image/gif", "image/webp"])(
    "encodes binary %s without attaching it",
    async (mimeType) => {
      const bytes = Uint8Array.from(
        { length: 180_000 },
        (_, index) => index % 256
      );
      const fetchImage = vi.fn().mockResolvedValue(
        new Response(bytes, {
          headers: {
            "Content-Type": `${mimeType.toUpperCase()}; charset=binary`,
          },
        })
      );
      vi.stubGlobal("fetch", fetchImage);
      const signal = new AbortController().signal;
      expect(
        await fetchContextImage("https://example.com/cover", signal)
      ).toEqual({
        type: "image",
        mimeType,
        data: Buffer.from(bytes).toString("base64"),
      });
      expect(fetchImage).toHaveBeenCalledWith("https://example.com/cover", {
        signal,
      });
    }
  );

  it.each([
    [new Response("no", { status: 404 }), "HTTP 404"],
    [
      new Response("svg", { headers: { "Content-Type": "image/svg+xml" } }),
      "MIME",
    ],
    [new Response(new Uint8Array()), "MIME"],
    [
      new Response(new Uint8Array(), {
        headers: { "Content-Type": "image/png" },
      }),
      "empty",
    ],
  ])(
    "rejects unusable responses without producing a block",
    async (response, message) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(
        fetchContextImage(
          "https://example.com/cover",
          new AbortController().signal
        )
      ).rejects.toThrow(String(message));
    }
  );

  it("propagates request/body failures and cancellation", async () => {
    const fetchImage = vi
      .fn()
      .mockRejectedValueOnce(new Error("CORS failure"))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("body failed"));
            },
          }),
          { headers: { "Content-Type": "image/png" } }
        )
      );
    vi.stubGlobal("fetch", fetchImage);
    await expect(
      fetchContextImage(
        "https://example.com/cover",
        new AbortController().signal
      )
    ).rejects.toThrow("CORS failure");
    await expect(
      fetchContextImage(
        "https://example.com/cover",
        new AbortController().signal
      )
    ).rejects.toThrow("body failed");
    const controller = new AbortController();
    fetchImage.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          pull(stream) {
            controller.abort();
            stream.enqueue(new Uint8Array([1]));
          },
        }),
        { headers: { "Content-Type": "image/png" } }
      )
    );
    await expect(
      fetchContextImage("https://example.com/cover", controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
