/**
 * Tests for useFiles hook after removing ChatGPT Apps SDK support.
 *
 * - isSupported should always be false for MCP Apps-only mode.
 * - upload and getDownloadUrl should throw unsupported errors.
 */
import { describe, expect, it, vi } from "vitest";

// Minimal mock: useMemo runs the factory synchronously
vi.mock("react", () => ({
  useMemo: (factory: () => unknown) => factory(),
}));

const { useFiles } = await import("../../../src/react/useFiles.js");

describe("useFiles (MCP Apps only)", () => {
  it("isSupported is false", () => {
    const { isSupported } = useFiles();
    expect(isSupported).toBe(false);
  });

  it("upload throws unsupported error", async () => {
    const { upload } = useFiles();
    await expect(upload(new File(["test"], "test.txt"))).rejects.toThrow(
      "[useFiles] File operations are not supported when only MCP Apps protocol is enabled."
    );
  });

  it("getDownloadUrl throws unsupported error", async () => {
    const { getDownloadUrl } = useFiles();
    await expect(getDownloadUrl({ fileId: "file_abc" })).rejects.toThrow(
      "[useFiles] File operations are not supported when only MCP Apps protocol is enabled."
    );
  });
});
