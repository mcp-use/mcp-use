// @vitest-environment happy-dom
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ComponentType } from "react";

import {
  bootstrapView,
  disposeView,
  useFiles,
  type FileMetadata,
  type UseFilesResult,
} from "../src/react/index.js";
import { createPairedTransports } from "./helpers/paired-transport.js";

interface TestOpenAiFilesApi {
  uploadFile?: (file: File) => Promise<FileMetadata>;
  getFileDownloadUrl?: (file: FileMetadata) => Promise<{ downloadUrl: string }>;
}

function setOpenAi(api: TestOpenAiFilesApi | undefined): void {
  if (api === undefined) {
    Reflect.deleteProperty(window, "openai");
    return;
  }
  Object.defineProperty(window, "openai", {
    value: api,
    configurable: true,
    writable: true,
  });
}

async function startHost() {
  const [guestTransport, hostTransport] = createPairedTransports();
  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    { openLinks: {}, serverTools: {} }
  );
  const init = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });
  await bridge.connect(hostTransport);
  return { bridge, guestTransport, init };
}

afterEach(async () => {
  await disposeView();
  setOpenAi(undefined);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useFiles", () => {
  it("uploads files and retrieves download URLs without touching widget state", async () => {
    const uploadFile = vi.fn(async () => ({ fileId: "file-new" }));
    const getFileDownloadUrl = vi.fn(async () => ({
      downloadUrl: "https://files.example/new",
    }));
    const setWidgetState = vi.fn(async () => {});
    setOpenAi({
      uploadFile,
      getFileDownloadUrl,
      setWidgetState,
    } as TestOpenAiFilesApi);

    const { bridge, guestTransport, init } = await startHost();
    let files: UseFilesResult | undefined;
    let renders = 0;

    function View() {
      renders += 1;
      files = useFiles();
      return <div data-testid="supported">{String(files.isSupported)}</div>;
    }

    bootstrapView(
      { default: View as ComponentType },
      { transport: guestTransport }
    );
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("supported").textContent).toBe("true");
    });

    const rendersAfterMount = renders;
    const handle = files as UseFilesResult;
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await expect(handle.upload(file)).resolves.toEqual({ fileId: "file-new" });
    expect(uploadFile).toHaveBeenCalledWith(file);
    expect(setWidgetState).not.toHaveBeenCalled();

    await expect(
      handle.getDownloadUrl({ fileId: "file-new" })
    ).resolves.toEqual({ downloadUrl: "https://files.example/new" });
    expect(getFileDownloadUrl).toHaveBeenCalledWith({ fileId: "file-new" });

    await bridge.sendToolInput({ arguments: { query: "unrelated" } });
    await bridge.sendHostContextChange({ theme: "dark" });
    await Promise.resolve();
    expect(renders).toBe(rendersAfterMount);

    await bridge.close();
  });

  it("reports unsupported hosts and rejects both actions", async () => {
    setOpenAi({
      uploadFile: vi.fn(async () => ({ fileId: "partial" })),
    });

    const { bridge, guestTransport, init } = await startHost();
    let files: UseFilesResult | undefined;

    function View() {
      files = useFiles();
      return <div data-testid="supported">{String(files.isSupported)}</div>;
    }

    bootstrapView(
      { default: View as ComponentType },
      { transport: guestTransport }
    );
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("supported").textContent).toBe("false");
    });

    const handle = files as UseFilesResult;
    await expect(handle.upload(new File(["x"], "x.txt"))).rejects.toThrow(
      "File upload is not supported in this host"
    );
    await expect(handle.getDownloadUrl({ fileId: "x" })).rejects.toThrow(
      "File download is not supported in this host"
    );

    await bridge.close();
  });

  it("keeps action identities stable and rejects them after disposal", async () => {
    setOpenAi({
      uploadFile: vi.fn(async () => ({ fileId: "file" })),
      getFileDownloadUrl: vi.fn(async () => ({ downloadUrl: "https://x" })),
    });

    const { bridge, guestTransport, init } = await startHost();
    const handles: UseFilesResult[] = [];

    function View() {
      const [count, setCount] = useState(0);
      const files = useFiles();
      handles.push(files);
      return (
        <button onClick={() => setCount((value) => value + 1)}>{count}</button>
      );
    }

    bootstrapView(
      { default: View as ComponentType },
      { transport: guestTransport }
    );
    await init;
    await waitFor(() => expect(handles.length).toBeGreaterThan(0));
    const first = handles.at(-1) as UseFilesResult;

    screen.getByRole("button").click();
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("1")
    );
    const second = handles.at(-1) as UseFilesResult;
    expect(second).toBe(first);
    expect(second.upload).toBe(first.upload);
    expect(second.getDownloadUrl).toBe(first.getDownloadUrl);

    await disposeView();
    await expect(first.upload(new File(["x"], "x.txt"))).rejects.toThrow(
      "View runtime has been disposed"
    );
    await expect(first.getDownloadUrl({ fileId: "x" })).rejects.toThrow(
      "View runtime has been disposed"
    );

    await bridge.close();
  });
});
