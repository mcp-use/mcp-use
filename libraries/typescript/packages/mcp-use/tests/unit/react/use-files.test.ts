/**
 * Tests for the useFiles hook:
 *
 * - isSupported detection (presence of window.openai.uploadFile / getFileDownloadUrl)
 * - upload() delegates to window.openai.uploadFile
 * - upload() tracks fileId in imageIds when modelVisible is true (default)
 * - upload() does NOT track fileId when modelVisible is false
 * - upload() preserves existing imageIds and widgetState when adding a new fileId
 * - getDownloadUrl() delegates to window.openai.getFileDownloadUrl
 * - Both upload() and getDownloadUrl() throw descriptive errors when isSupported is false
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — we test the hook logic directly without React rendering by
// calling the functions returned from a minimal hook invocation.
// We mock React.useMemo to run the factory immediately (no-op wrapper).
// ---------------------------------------------------------------------------

// Minimal mock: useMemo runs the factory synchronously
vi.mock("react", () => ({
  useMemo: (factory: () => unknown) => factory(),
}));

// Import AFTER mocking React so useMemo is already replaced
const { useFiles } = await import("../../../src/react/useFiles.js");

// ---------------------------------------------------------------------------
// window.openai mock helpers
// ---------------------------------------------------------------------------

type OpenAiMock = {
  uploadFile: ReturnType<typeof vi.fn>;
  getFileDownloadUrl: ReturnType<typeof vi.fn>;
  setWidgetState: ReturnType<typeof vi.fn>;
  widgetState: Record<string, unknown> | null;
};

function mockOpenAi(overrides: Partial<OpenAiMock> = {}): OpenAiMock {
  const mock: OpenAiMock = {
    uploadFile: vi.fn(),
    getFileDownloadUrl: vi.fn(),
    setWidgetState: vi.fn().mockResolvedValue(undefined),
    widgetState: null,
    ...overrides,
  };
  (global as any).window = { openai: mock };
  return mock;
}

function clearOpenAi() {
  (global as any).window = { openai: undefined };
}

beforeEach(() => {
  clearOpenAi();
});

afterEach(() => {
  clearOpenAi();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isSupported
// ---------------------------------------------------------------------------

describe("isSupported", () => {
  it("is false when window is undefined", () => {
    (global as any).window = undefined;
    const { isSupported } = useFiles();
    expect(isSupported).toBe(false);
  });

  it("is false when window.openai is undefined", () => {
    (global as any).window = {};
    const { isSupported } = useFiles();
    expect(isSupported).toBe(false);
  });

  it("is false when only uploadFile is present", () => {
    (global as any).window = { openai: { uploadFile: vi.fn() } };
    const { isSupported } = useFiles();
    expect(isSupported).toBe(false);
  });

  it("is false when only getFileDownloadUrl is present", () => {
    (global as any).window = { openai: { getFileDownloadUrl: vi.fn() } };
    const { isSupported } = useFiles();
    expect(isSupported).toBe(false);
  });

  it("is true when both uploadFile and getFileDownloadUrl are functions", () => {
    mockOpenAi();
    const { isSupported } = useFiles();
    expect(isSupported).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// upload() — error when not supported
// ---------------------------------------------------------------------------

describe("upload() when not supported", () => {
  it("throws a descriptive error", async () => {
    clearOpenAi();
    const { upload } = useFiles();

    await expect(upload(new File(["content"], "test.txt"))).rejects.toThrow(
      "[useFiles] File upload is not supported in this host."
    );
  });

  it("error message mentions isSupported", async () => {
    clearOpenAi();
    const { upload } = useFiles();
    await expect(upload(new File([], "f.txt"))).rejects.toThrow("isSupported");
  });
});

// ---------------------------------------------------------------------------
// upload() — delegation and model visibility
// ---------------------------------------------------------------------------

describe("upload() model-visible (default)", () => {
  it("calls window.openai.uploadFile with the file", async () => {
    const openai = mockOpenAi();
    openai.uploadFile.mockResolvedValue({ fileId: "file_abc" });

    const { upload } = useFiles();
    const file = new File(["data"], "photo.png", { type: "image/png" });
    await upload(file);

    expect(openai.uploadFile).toHaveBeenCalledOnce();
    expect(openai.uploadFile).toHaveBeenCalledWith(file);
  });

  it("returns the FileMetadata from uploadFile", async () => {
    const openai = mockOpenAi();
    openai.uploadFile.mockResolvedValue({ fileId: "file_xyz" });

    const { upload } = useFiles();
    const result = await upload(new File([], "img.jpg"));

    expect(result).toEqual({ fileId: "file_xyz" });
  });

  it("calls setWidgetState with imageIds containing the fileId", async () => {
    const openai = mockOpenAi();
    openai.uploadFile.mockResolvedValue({ fileId: "file_001" });

    const { upload } = useFiles();
    await upload(new File([], "test.png"));

    expect(openai.setWidgetState).toHaveBeenCalledOnce();
    const callArg = openai.setWidgetState.mock.calls[0][0];
    expect(callArg.imageIds).toContain("file_001");
  });

  it("appends to existing imageIds without replacing them", async () => {
    const openai = mockOpenAi();
    openai.widgetState = { imageIds: ["file_existing"], other: "value" };
    openai.uploadFile.mockResolvedValue({ fileId: "file_new" });

    const { upload } = useFiles();
    await upload(new File([], "test.png"));

    const callArg = openai.setWidgetState.mock.calls[0][0];
    expect(callArg.imageIds).toEqual(["file_existing", "file_new"]);
  });

  it("preserves other widgetState fields when adding imageIds", async () => {
    const openai = mockOpenAi();
    openai.widgetState = { selectedItem: "item-42", theme: "dark" };
    openai.uploadFile.mockResolvedValue({ fileId: "file_001" });

    const { upload } = useFiles();
    await upload(new File([], "test.png"));

    const callArg = openai.setWidgetState.mock.calls[0][0];
    expect(callArg.selectedItem).toBe("item-42");
    expect(callArg.theme).toBe("dark");
    expect(callArg.imageIds).toContain("file_001");
  });
});

describe("upload() with modelVisible: false", () => {
  it("still calls uploadFile", async () => {
    const openai = mockOpenAi();
    openai.uploadFile.mockResolvedValue({ fileId: "file_private" });

    const { upload } = useFiles();
    await upload(new File([], "private.pdf"), { modelVisible: false });

    expect(openai.uploadFile).toHaveBeenCalledOnce();
  });

  it("does NOT call setWidgetState", async () => {
    const openai = mockOpenAi();
    openai.uploadFile.mockResolvedValue({ fileId: "file_private" });

    const { upload } = useFiles();
    await upload(new File([], "private.pdf"), { modelVisible: false });

    expect(openai.setWidgetState).not.toHaveBeenCalled();
  });

  it("still returns the FileMetadata", async () => {
    const openai = mockOpenAi();
    openai.uploadFile.mockResolvedValue({ fileId: "file_private" });

    const { upload } = useFiles();
    const result = await upload(new File([], "private.pdf"), {
      modelVisible: false,
    });

    expect(result).toEqual({ fileId: "file_private" });
  });

  it("does not add the fileId to imageIds", async () => {
    const openai = mockOpenAi();
    openai.widgetState = { imageIds: ["file_existing"] };
    openai.uploadFile.mockResolvedValue({ fileId: "file_private" });

    const { upload } = useFiles();
    await upload(new File([], "private.pdf"), { modelVisible: false });

    // setWidgetState not called, so imageIds unchanged
    expect(openai.setWidgetState).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getDownloadUrl()
// ---------------------------------------------------------------------------

describe("getDownloadUrl() when not supported", () => {
  it("throws a descriptive error", async () => {
    clearOpenAi();
    const { getDownloadUrl } = useFiles();
    await expect(getDownloadUrl({ fileId: "file_abc" })).rejects.toThrow(
      "[useFiles] File download is not supported in this host."
    );
  });
});

describe("getDownloadUrl() when supported", () => {
  it("delegates to window.openai.getFileDownloadUrl", async () => {
    const openai = mockOpenAi();
    openai.getFileDownloadUrl.mockResolvedValue({
      downloadUrl: "https://example.com/file.pdf",
    });

    const { getDownloadUrl } = useFiles();
    const result = await getDownloadUrl({ fileId: "file_abc" });

    expect(openai.getFileDownloadUrl).toHaveBeenCalledWith({
      fileId: "file_abc",
    });
    expect(result).toEqual({ downloadUrl: "https://example.com/file.pdf" });
  });

  it("passes through the fileId from FileMetadata", async () => {
    const openai = mockOpenAi();
    openai.getFileDownloadUrl.mockResolvedValue({
      downloadUrl: "https://cdn.test/f",
    });

    const { getDownloadUrl } = useFiles();
    await getDownloadUrl({ fileId: "sediment://file_xyz" });

    expect(openai.getFileDownloadUrl).toHaveBeenCalledWith({
      fileId: "sediment://file_xyz",
    });
  });
});
