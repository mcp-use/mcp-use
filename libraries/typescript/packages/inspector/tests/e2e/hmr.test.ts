import { expect, test, type Page } from "@playwright/test";

import { goToInspectorWithAutoConnectAndOpenTools } from "./helpers/connection";
import {
  backupFile,
  CONFORMANCE_SERVER_PATH,
  CONFORMANCE_WEATHER_VIEW_PATH,
  removeConformancePublicFile,
  removeConformanceViewDir,
  restoreFile,
  writeConformanceFile,
  writeConformancePublicFile,
  writeConformanceViewFile,
} from "./helpers/file-utils";
import { getMcpAppsGuestFrame } from "./helpers/debugger-tools";
import { getTestMatrix, skipIfNotSupported } from "./helpers/test-matrix";

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    name: "inspector-hmr-e2e",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    },
  },
};

function replaceOnce(source: string, before: string, after: string): string {
  const index = source.indexOf(before);
  if (index === -1) {
    throw new Error(`HMR fixture drift: missing ${JSON.stringify(before)}`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function insertBeforeExport(source: string, registration: string): string {
  return replaceOnce(
    source,
    "export default server;",
    `${registration.trim()}\n\nexport default server;`
  );
}

function removeRegistration(
  source: string,
  call: "server.tool(" | "server.prompt(" | "server.resource(",
  name: string
): string {
  const marker = `name: "${name}"`;
  const markerIndex = source.indexOf(marker);
  const start = source.lastIndexOf(call, markerIndex);
  const end = source.indexOf("\n);\n", markerIndex);
  if (markerIndex === -1 || start === -1 || end === -1) {
    throw new Error(`HMR fixture drift: cannot remove ${name}`);
  }
  return source.slice(0, start) + source.slice(end + 4);
}

async function mcpRequest<T>(
  page: Page,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const { serverUrl } = getTestMatrix();
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-method": method,
    "mcp-protocol-version": "2026-07-28",
  };
  const subject = params["name"] ?? params["uri"];
  if (typeof subject === "string") headers["mcp-name"] = subject;

  const response = await page.request.post(serverUrl, {
    headers,
    data: {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params: { ...params, _meta: META },
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { result: T };
  return body.result;
}

async function toolNames(page: Page): Promise<string[]> {
  const result = await mcpRequest<{ tools: { name: string }[] }>(
    page,
    "tools/list"
  );
  return result.tools.map((tool) => tool.name);
}

test.describe("v2 server reload propagation", () => {
  test.describe.configure({ mode: "serial" });
  const skipReason = skipIfNotSupported("hmr");
  test.skip(!!skipReason, skipReason || undefined);

  let originalServer = "";
  let originalView = "";
  const dynamicViews = ["hmr-dynamic-view", "hmr-renamed-view"];
  const publicFile = "hmr-live.txt";

  test.beforeEach(async ({ page, context }) => {
    originalServer = await backupFile(CONFORMANCE_SERVER_PATH);
    originalView = await backupFile(CONFORMANCE_WEATHER_VIEW_PATH);
    await context.clearCookies();
    await goToInspectorWithAutoConnectAndOpenTools(page);
  });

  test.afterEach(async ({ page }) => {
    await restoreFile(originalServer, CONFORMANCE_SERVER_PATH);
    await restoreFile(originalView, CONFORMANCE_WEATHER_VIEW_PATH);
    await Promise.all([
      ...dynamicViews.map(removeConformanceViewDir),
      removeConformancePublicFile(publicFile),
    ]);
    await expect.poll(() => toolNames(page)).toContain("test_simple_text");
  });

  test("tools add, update, rename, execute, and delete without reconnecting", async ({
    page,
  }) => {
    let source = originalServer;

    source = replaceOnce(
      source,
      'description: "A simple tool that returns text content"',
      'description: "Tool metadata updated live"'
    );
    await writeConformanceFile(source);
    await expect(
      page
        .getByTestId("tool-item-test_simple_text")
        .getByText("Tool metadata updated live")
    ).toBeVisible();

    source = replaceOnce(
      source,
      "message: z.string().optional(),",
      'message: z.string().optional(),\n      suffix: z.string().optional().describe("Live suffix"),'
    );
    source = replaceOnce(
      source,
      // eslint-disable-next-line no-template-curly-in-string
      "text: `Echo: ${message}`",
      // eslint-disable-next-line no-template-curly-in-string
      "text: `Live Echo: ${message}`"
    );
    await writeConformanceFile(source);
    await page.getByTestId("tool-item-test_simple_text").click();
    await expect(page.getByTestId("tool-param-suffix")).toBeVisible();
    await page.getByTestId("tool-param-message").fill("hello");
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByText("Live Echo: hello")).toBeVisible();

    source = replaceOnce(
      source,
      'name: "test_simple_text"',
      'name: "test_simple_text_renamed"'
    );
    await writeConformanceFile(source);
    await expect(
      page.getByTestId("tool-item-test_simple_text")
    ).not.toBeVisible();
    await expect(
      page.getByTestId("tool-item-test_simple_text_renamed")
    ).toBeVisible();

    source = removeRegistration(
      source,
      "server.tool(",
      "test_simple_text_renamed"
    );
    await writeConformanceFile(source);
    await expect(
      page.getByTestId("tool-item-test_simple_text_renamed")
    ).not.toBeVisible();

    source = insertBeforeExport(
      source,
      `
server.tool(
  { name: "hmr_added_tool", description: "Added after startup" },
  async () => ({ content: [{ type: "text", text: "Added tool works" }] })
);`
    );
    await writeConformanceFile(source);
    await page.getByTestId("tool-item-hmr_added_tool").click();
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByText("Added tool works")).toBeVisible();
  });

  test("prompts add, update, rename, execute, and delete", async ({ page }) => {
    await page.getByRole("button", { name: "Prompts", exact: true }).click();
    let source = originalServer;

    source = replaceOnce(
      source,
      'description: "A simple prompt without arguments"',
      'description: "Prompt metadata updated live"'
    );
    source = replaceOnce(
      source,
      'text: "This is a simple prompt without any arguments."',
      'text: "Prompt content updated live"'
    );
    await writeConformanceFile(source);
    const prompt = page.getByTestId("prompt-item-test_simple_prompt");
    await expect(
      prompt.getByText("Prompt metadata updated live")
    ).toBeVisible();
    await prompt.click();
    await page.getByTestId("prompt-execute-button").click();
    await expect(page.getByText("Prompt content updated live")).toBeVisible();

    source = replaceOnce(
      source,
      'name: "test_simple_prompt"',
      'name: "test_simple_prompt_renamed"'
    );
    await writeConformanceFile(source);
    await expect(
      page.getByTestId("prompt-item-test_simple_prompt")
    ).not.toBeVisible();
    await expect(
      page.getByTestId("prompt-item-test_simple_prompt_renamed")
    ).toBeVisible();

    source = removeRegistration(
      source,
      "server.prompt(",
      "test_simple_prompt_renamed"
    );
    source = insertBeforeExport(
      source,
      `
server.prompt(
  {
    name: "hmr_added_prompt",
    description: "Added prompt",
    schema: z.object({ topic: z.string().optional() }),
  },
  async ({ topic = "default" }) => ({
    messages: [{ role: "user", content: { type: "text", text: \`Topic: \${topic}\` } }],
  })
);`
    );
    await writeConformanceFile(source);
    await expect(
      page.getByTestId("prompt-item-test_simple_prompt_renamed")
    ).not.toBeVisible();
    await page.getByTestId("prompt-item-hmr_added_prompt").click();
    await expect(page.getByTestId("prompt-param-topic")).toBeVisible();
  });

  test("resources and templates add, update, rename, read, and delete", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Resources", exact: true }).click();
    let source = originalServer;

    source = replaceOnce(
      source,
      'description: "A static text resource"',
      'description: "Resource metadata updated live"'
    );
    source = replaceOnce(
      source,
      'text: "This is static text content"',
      'text: "Resource content updated live"'
    );
    await writeConformanceFile(source);
    const resource = page.getByTestId("resource-item-static_text");
    await expect(
      resource.getByText("Resource metadata updated live")
    ).toBeVisible();
    await resource.click();
    await expect(page.getByText("Resource content updated live")).toBeVisible();

    source = replaceOnce(
      source,
      'name: "static_text"',
      'name: "static_text_renamed"'
    );
    source = replaceOnce(
      source,
      'uri: "test://static-text"',
      'uri: "test://static-text-renamed"'
    );
    await writeConformanceFile(source);
    await expect(
      page.getByTestId("resource-item-static_text")
    ).not.toBeVisible();
    await expect(
      page.getByTestId("resource-item-static_text_renamed")
    ).toBeVisible();

    source = removeRegistration(
      source,
      "server.resource(",
      "static_text_renamed"
    );
    source = insertBeforeExport(
      source,
      `
server.resource(
  {
    name: "hmr_added_resource",
    uri: "test://hmr-added",
    description: "Added resource",
    mimeType: "text/plain",
  },
  async (uri) => ({ contents: [{ uri: uri.href, text: "Added resource works" }] })
);`
    );
    await writeConformanceFile(source);
    await expect(
      page.getByTestId("resource-item-static_text_renamed")
    ).not.toBeVisible();
    await page.getByTestId("resource-item-hmr_added_resource").click();
    await expect(page.getByText("Added resource works")).toBeVisible();

    source = replaceOnce(
      source,
      'name: "template_resource"',
      'name: "template_resource_renamed"'
    );
    source = replaceOnce(
      source,
      'description: "A templated resource"',
      'description: "Template metadata updated live"'
    );
    await writeConformanceFile(source);
    await expect
      .poll(async () => {
        const result = await mcpRequest<{
          resourceTemplates: { name: string; description?: string }[];
        }>(page, "resources/templates/list");
        return result.resourceTemplates.find(
          (template) => template.name === "template_resource_renamed"
        )?.description;
      })
      .toBe("Template metadata updated live");
  });

  test("view metadata and CSP changes propagate through resources/list", async ({
    page,
  }) => {
    let source = originalServer;
    source = replaceOnce(
      source,
      `view: {
      name: "weather-display",
      description:
        "Interactive weather card showing temperature and conditions",
    },`,
      `view: {
      name: "weather-display",
      description: "Weather view metadata updated live",
      csp: {
        connectDomains: ["https://api.updated.example"],
        resourceDomains: ["https://cdn.updated.example"],
      },
      permissions: { clipboardWrite: {} },
      domain: "https://views.updated.example",
      prefersBorder: true,
    },`
    );
    await writeConformanceFile(source);

    await expect
      .poll(async () => {
        const result = await mcpRequest<{
          resources: {
            uri: string;
            description?: string;
            _meta?: Record<string, unknown>;
          }[];
        }>(page, "resources/list");
        return result.resources.find(
          (resource) => resource.uri === "ui://views/weather-display.html"
        );
      })
      .toMatchObject({
        description: "Weather view metadata updated live",
        _meta: {
          ui: {
            csp: {
              connectDomains: expect.arrayContaining([
                "https://api.updated.example",
              ]),
              resourceDomains: expect.arrayContaining([
                "https://cdn.updated.example",
              ]),
            },
            permissions: { clipboardWrite: {} },
            domain: "https://views.updated.example",
            prefersBorder: true,
          },
        },
      });
  });

  test("view code hot-updates in the mounted Inspector iframe", async ({
    page,
  }) => {
    await page.getByTestId("tool-item-get-weather-delayed").click();
    await page.getByTestId("tool-param-city").fill("tokyo");
    await page.getByTestId("tool-param-delay").fill("1");
    await page.getByTestId("tool-execution-execute-button").click();

    const frame = getMcpAppsGuestFrame(page, "get-weather-delayed");
    await expect(frame.getByText("Weather view v1")).toBeVisible();
    await writeConformanceFile(
      replaceOnce(originalView, "Weather view v1", "Weather view v2"),
      CONFORMANCE_WEATHER_VIEW_PATH
    );
    await expect(frame.getByText("Weather view v2")).toBeVisible();
  });

  test("views can be added, renamed, and removed while connected", async ({
    page,
  }) => {
    const viewSource = `
export default function DynamicView() {
  return <p>Dynamic HMR view</p>;
}
`;
    await writeConformanceViewFile("hmr-dynamic-view", "view.tsx", viewSource);
    let source = insertBeforeExport(
      originalServer,
      `
server.tool(
  {
    name: "hmr_dynamic_view_tool",
    description: "Dynamic view tool",
    outputSchema: z.object({ message: z.string() }),
    view: { name: "hmr-dynamic-view", description: "Dynamic view resource" },
  },
  async () => ({
    content: [{ type: "text", text: "Dynamic view" }],
    structuredContent: { message: "Dynamic view" },
  })
);`
    );
    await writeConformanceFile(source);
    await expect(
      page.getByTestId("tool-item-hmr_dynamic_view_tool")
    ).toBeVisible();
    await expect
      .poll(async () => {
        const result = await mcpRequest<{ resources: { uri: string }[] }>(
          page,
          "resources/list"
        );
        return result.resources.map((resource) => resource.uri);
      })
      .toContain("ui://views/hmr-dynamic-view.html");

    await writeConformanceViewFile(
      "hmr-renamed-view",
      "view.tsx",
      viewSource.replace("Dynamic HMR view", "Renamed HMR view")
    );
    await removeConformanceViewDir("hmr-dynamic-view");
    source = source.replaceAll("hmr-dynamic-view", "hmr-renamed-view");
    await writeConformanceFile(source);
    await expect
      .poll(async () => {
        const result = await mcpRequest<{ resources: { uri: string }[] }>(
          page,
          "resources/list"
        );
        return result.resources.map((resource) => resource.uri);
      })
      .toEqual(expect.arrayContaining(["ui://views/hmr-renamed-view.html"]));

    source = removeRegistration(
      source,
      "server.tool(",
      "hmr_dynamic_view_tool"
    );
    await removeConformanceViewDir("hmr-renamed-view");
    await writeConformanceFile(source);
    await expect(
      page.getByTestId("tool-item-hmr_dynamic_view_tool")
    ).not.toBeVisible();
    await expect
      .poll(async () => {
        const result = await mcpRequest<{ resources: { uri: string }[] }>(
          page,
          "resources/list"
        );
        return result.resources.map((resource) => resource.uri);
      })
      .not.toContain("ui://views/hmr-renamed-view.html");
  });

  test("public static files can be added, updated, and deleted live", async ({
    page,
  }) => {
    const { serverUrl } = getTestMatrix();
    const publicUrl = `${serverUrl}/_mcp-use/public/${publicFile}`;

    expect((await page.request.get(publicUrl)).status()).toBe(404);
    await writeConformancePublicFile(publicFile, "static-v1");
    await expect
      .poll(async () => (await page.request.get(publicUrl)).text())
      .toBe("static-v1");

    await writeConformancePublicFile(publicFile, "static-v2");
    await expect
      .poll(async () => (await page.request.get(publicUrl)).text())
      .toBe("static-v2");

    await removeConformancePublicFile(publicFile);
    await expect
      .poll(async () => (await page.request.get(publicUrl)).status())
      .toBe(404);
  });
});
