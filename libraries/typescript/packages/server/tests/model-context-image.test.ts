import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchContextImage } from "../src/react/runtime/model-context-image.js";

afterEach(() => vi.unstubAllGlobals());

describe("fetchContextImage", () => {
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
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "Content-Type": "image/png" }),
        arrayBuffer: () => Promise.reject(new Error("body failed")),
      });
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
    fetchImage.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "Content-Type": "image/png" }),
      arrayBuffer: async () => {
        controller.abort();
        return new Uint8Array([1]).buffer;
      },
    });
    await expect(
      fetchContextImage("https://example.com/cover", controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
