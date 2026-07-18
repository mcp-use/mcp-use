// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { injectOpenAiFileApis } from "../../src/react/view/inject-openai-file-apis.js";

async function runInjectedFileApis(html: string) {
  const injected = injectOpenAiFileApis(html);
  expect(injected).toContain("uploadFile");
  expect(injected).toContain("getFileDownloadUrl");

  const scriptMatch = injected.match(/<script>[\s\S]*?<\/script>/);
  expect(scriptMatch).not.toBeNull();
  // eslint-disable-next-line no-new-func
  new Function(scriptMatch![0].replace(/^<script>|<\/script>$/g, ""))();

  const api = (
    window as unknown as {
      openai?: {
        uploadFile?: (file: File) => Promise<{ fileId: string }>;
        getFileDownloadUrl?: (ref: {
          fileId: string;
        }) => Promise<{ downloadUrl: string }>;
      };
    }
  ).openai;

  expect(api?.uploadFile).toBeTypeOf("function");
  expect(api?.getFileDownloadUrl).toBeTypeOf("function");

  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  const { fileId } = await api!.uploadFile!(file);
  expect(fileId).toBeTruthy();

  const { downloadUrl } = await api!.getFileDownloadUrl!({ fileId });
  expect(downloadUrl).toMatch(/^blob:/);

  const response = await fetch(downloadUrl);
  expect(await response.text()).toBe("hello");

  Reflect.deleteProperty(window, "openai");
}

describe("injectOpenAiFileApis", () => {
  it("injects into head and round-trips upload/download", async () => {
    await runInjectedFileApis("<html><head></head><body></body></html>");
  });

  it("prepends when html has no head", async () => {
    await runInjectedFileApis("<div>widget</div>");
  });
});

describe("injectOpenAiFileApis HTML shape", () => {
  it("places script before existing head content", () => {
    const html = "<html><head><title>x</title></head></html>";
    const injected = injectOpenAiFileApis(html);
    expect(injected.indexOf("uploadFile")).toBeLessThan(
      injected.indexOf("<title>")
    );
  });
});
