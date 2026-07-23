// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { injectOpenAiFileApis } from "../../src/react/view/inject-openai-file-apis.js";

async function runInjectedFileApis(html: string) {
  const injected = injectOpenAiFileApis(html);
  expect(injected).toContain("uploadFile");
  expect(injected).toContain("getFileDownloadUrl");

  const parsed = new DOMParser().parseFromString(injected, "text/html");
  const script = Array.from(parsed.scripts).find((candidate) =>
    candidate.textContent?.includes("window.openai.uploadFile")
  );
  expect(script?.textContent).toBeTruthy();
  // eslint-disable-next-line no-new-func
  new Function(script!.textContent!)();

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

  it("handles mixed-case tags and long doctypes without regular expressions", () => {
    const attributes = ' data-test="x"'.repeat(2_000);
    const html = `<!DoCtYpE html${attributes}><HtMl><HeAd></HeAd></HtMl>`;
    const injected = injectOpenAiFileApis(html);
    expect(injected).toContain("<HeAd><script>");
    expect(injected.indexOf("uploadFile")).toBeLessThan(
      injected.indexOf("</HeAd>")
    );
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
