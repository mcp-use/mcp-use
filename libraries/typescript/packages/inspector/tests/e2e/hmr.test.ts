import { expect, test } from "@playwright/test";
import {
  goToInspectorWithAutoConnectAndOpenTools,
  waitForHMRReload,
} from "./helpers/connection";
import {
  backupFile,
  CONFORMANCE_SERVER_PATH,
  CONFORMANCE_WEATHER_WIDGET_PATH,
  readConformanceFile,
  restoreFile,
  writeConformanceFile,
} from "./helpers/file-utils";
import { skipIfNotSupported } from "./helpers/test-matrix";

test.describe("HMR (Hot Module Reload)", () => {
  const skipReason = skipIfNotSupported("hmr");
  // test.skip(!!skipReason, skipReason || undefined);

  let originalServerContent: string | null = null;
  let originalWidgetContent: string | null = null;

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await goToInspectorWithAutoConnectAndOpenTools(page);
  });

  test.afterEach(async () => {
    if (originalServerContent !== null) {
      await restoreFile(originalServerContent, CONFORMANCE_SERVER_PATH);
      originalServerContent = null;
    }
    if (originalWidgetContent !== null) {
      await restoreFile(originalWidgetContent, CONFORMANCE_WEATHER_WIDGET_PATH);
      originalWidgetContent = null;
    }
    // Wait for HMR to complete after file restoration
    // This ensures the server is stable before the next test starts
    // and widget tools have time to re-register
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  test("tool addition - new tool appears in UI after HMR", async ({ page }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    const hmrToolSnippet = `
server.tool(
  {
    name: "hmr-test-tool",
    description: "Added via HMR",
  },
  async () => text("HMR works!")
);
`;
    const newContent = content.replace(
      "await server.listen();",
      `${hmrToolSnippet}\nawait server.listen();`
    );
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await expect(page.getByTestId("tool-item-hmr-test-tool")).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId("tool-item-hmr-test-tool").click();
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByText("HMR works!")).toBeVisible({ timeout: 5000 });
  });

  test("tool removal - tool disappears from UI after HMR", async ({ page }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    const toolBlock = `// tools-call-simple-text (message is optional)
server.tool(
  {
    name: "test_simple_text",
    description: "A simple tool that returns text content",
    schema: z.object({
      message: z.string().optional(),
    }),
  },
  async ({ message = "Hello, World!" }: { message?: string }) =>
    text(\`Echo: \${message}\`)
);

`;
    const newContent = content.replace(
      toolBlock,
      "// test_simple_text removed for HMR test\n\n"
    );
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await expect(
      page.getByTestId("tool-item-test_simple_text")
    ).not.toBeVisible({
      timeout: 10000,
    });
  });

  test("tool metadata change - description updates in UI after HMR", async ({
    page,
  }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    const newContent = content.replace(
      'description: "A simple tool that returns text content"',
      'description: "Updated via HMR - new description"'
    );
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    // Check description in tool list
    const toolItem = page.getByTestId("tool-item-test_simple_text");
    await expect(
      toolItem.getByText("Updated via HMR - new description")
    ).toBeVisible({
      timeout: 10000,
    });

    // Check description in tool execution panel top
    await toolItem.click();
    await expect(page.getByTestId("tool-execution-description")).toHaveText(
      "Updated via HMR - new description",
      { timeout: 5000 }
    );

    // Execute the tool to verify it still works after HMR
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByText(/Echo:/)).toBeVisible({ timeout: 5000 });
  });

  test("tool handler logic change - new logic runs after HMR", async ({
    page,
  }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    // Change only the handler logic: add .toUpperCase() to the message
    // Name, description, and schema remain identical
    const newContent = content.replace(
      /text\(`Echo: \$\{message\}`\)/,
      // eslint-disable-next-line no-template-curly-in-string
      "text(`Echo: ${message.toUpperCase()}`)"
    );
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await page.getByTestId("tool-item-test_simple_text").click();
    await page.getByTestId("tool-param-message").fill("hello");
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByText("Echo: HELLO")).toBeVisible({ timeout: 5000 });
  });

  test("tool handler change - text to widget after HMR", async ({ page }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    // Replace the test_simple_text tool: change from returning text() to widget()
    // Reuses the existing weather-display widget build
    const oldToolBlock = `// tools-call-simple-text (message is optional)
server.tool(
  {
    name: "test_simple_text",
    description: "A simple tool that returns text content",
    schema: z.object({
      message: z.string().optional(),
    }),
  },
  async ({ message = "Hello, World!" }: { message?: string }) =>
    text(\`Echo: \${message}\`)
);`;
    const newToolBlock = `// tools-call-simple-text (message is optional)
server.tool(
  {
    name: "test_simple_text",
    description: "A simple tool that returns text content",
    schema: z.object({
      message: z.string().optional(),
    }),
    widget: {
      name: "weather-display",
    },
  },
  async ({ message = "Hello, World!" }: { message?: string }) =>
    widget({ props: { city: message, temperature: 99, conditions: "HMR Test", humidity: 50, windSpeed: 5 }, message: \`Widget: \${message}\` })
);`;
    const newContent = content.replace(oldToolBlock, newToolBlock);
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await page.getByTestId("tool-item-test_simple_text").click();
    await page.getByTestId("tool-param-message").fill("hmr-city");
    await page.getByTestId("tool-execution-execute-button").click();

    // The tool now returns a widget, so the widget view tabs should appear
    await expect(page.getByTestId("tool-result-view-chatgpt-app")).toBeVisible({
      timeout: 10000,
    });

    // Verify widget loads in MCP Apps iframe
    await page.getByTestId("tool-result-view-mcp-apps").click();
    const mcpAppsOuter = page.frameLocator(
      'iframe[title^="MCP App: test_simple_text"]'
    );
    const mcpAppsGuest = mcpAppsOuter.frameLocator("iframe");
    await expect(mcpAppsGuest.getByText("HMR Test")).toBeVisible({
      timeout: 10000,
    });
  });

  test("tool handler change - widget to text after HMR", async ({ page }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    // Replace get-weather-delayed: change from returning widget() to text()
    // Remove the widget config and simplify the handler
    const oldToolBlock = `server.tool(
  {
    name: "get-weather-delayed",
    description:
      "Get weather with artificial 5-second delay to test widget lifecycle (Issue #930)",
    schema: z.object({
      city: z.string().describe("City name"),
      delay: z
        .number()
        .default(5000)
        .describe("Delay in milliseconds (default: 5000)"),
    }),
    widget: {
      name: "weather-display",
      invoking: "Fetching weather data...",
      invoked: "Weather data loaded",
    },
  },
  async ({ city, delay }) => {
    await sleep(delay);

    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] || {
      temperature: 20,
      conditions: "Unknown",
      humidity: 50,
      windSpeed: 10,
    };

    return widget({
      props: {
        city,
        ...weather,
      },
      message: \`Current weather in \${city}: \${weather.conditions}, \${weather.temperature}°C (fetched after \${delay}ms delay)\`,
    });
  }
);`;
    const newToolBlock = `server.tool(
  {
    name: "get-weather-delayed",
    description:
      "Get weather with artificial 5-second delay to test widget lifecycle (Issue #930)",
    schema: z.object({
      city: z.string().describe("City name"),
      delay: z
        .number()
        .default(5000)
        .describe("Delay in milliseconds (default: 5000)"),
    }),
  },
  async ({ city }) => {
    return text(\`Weather for \${city}: sunny\`);
  }
);`;
    const newContent = content.replace(oldToolBlock, newToolBlock);
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await page.getByTestId("tool-item-get-weather-delayed").click();
    await page.getByTestId("tool-param-city").fill("tokyo");
    await page.getByTestId("tool-param-delay").fill("100");
    await page.getByTestId("tool-execution-execute-button").click();

    // The tool now returns text, not a widget
    await expect(page.getByText("Weather for tokyo: sunny")).toBeVisible({
      timeout: 10000,
    });
    // Widget view tabs should not appear
    await expect(
      page.getByTestId("tool-result-view-chatgpt-app")
    ).not.toBeVisible({ timeout: 3000 });
  });

  test("tool schema change - add parameter and test execution", async ({
    page,
  }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    const newContent = content.replace(
      'delay: z\n        .number()\n        .default(5000)\n        .describe("Delay in milliseconds (default: 5000)")',
      'delay: z\n        .number()\n        .default(5000)\n        .describe("Delay in milliseconds (default: 5000)"),\n      label: z.string().optional().describe("Optional label for HMR test")'
    );
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await page.getByTestId("tool-item-get-weather-delayed").click();
    await expect(page.getByTestId("tool-param-label")).toBeVisible({
      timeout: 10000,
    });

    // Test execution with new parameter
    await page.getByTestId("tool-param-city").fill("tokyo");
    await page.getByTestId("tool-param-delay").fill("100");
    await page.getByTestId("tool-param-label").fill("HMR Test");
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify widget loads in Apps SDK iframe
    await expect(page.getByTestId("tool-result-view-chatgpt-app")).toBeVisible({
      timeout: 5000,
    });
    await page.getByTestId("tool-result-view-chatgpt-app").click();
    const appsSdkFrame = page.frameLocator(
      'iframe[title^="OpenAI Component: get-weather-delayed"]'
    );
    await expect(appsSdkFrame.getByText(/tokyo/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(appsSdkFrame.getByText("Partly Cloudy")).toBeVisible();

    // Verify widget loads in MCP Apps iframe
    await page.getByTestId("tool-result-view-mcp-apps").click({
      timeout: 10000,
    });
    const mcpAppsOuter = page.frameLocator(
      'iframe[title^="MCP App: get-weather-delayed"]'
    );
    const mcpAppsGuest = mcpAppsOuter.frameLocator("iframe");
    await expect(mcpAppsGuest.getByText(/tokyo/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("tool schema change - remove parameter and test execution", async ({
    page,
  }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    const newContent = content.replace(
      `schema: z.object({
      message: z.string().optional(),
    }),`,
      `schema: z.object({}),`
    );
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await page.getByTestId("tool-item-test_simple_text").click();
    await expect(page.getByTestId("tool-param-message")).not.toBeVisible({
      timeout: 5000,
    });

    // Test execution without removed parameter
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByText(/Echo:/)).toBeVisible({ timeout: 5000 });
  });

  test("tool schema change - make parameter required and test execution", async ({
    page,
  }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const content = await readConformanceFile();
    const newContent = content.replace(
      `schema: z.object({
      message: z.string().optional(),
    }),`,
      `schema: z.object({
      message: z.string().describe("Required message"),
    }),`
    );
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await page.getByTestId("tool-item-test_simple_text").click();
    const messageInput = page.getByTestId("tool-param-message");
    await expect(messageInput).toBeVisible({ timeout: 10000 });

    // Test execution with required parameter
    await messageInput.fill("HMR required test");
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByText(/Echo: HMR required test/)).toBeVisible({
      timeout: 5000,
    });
  });

  test("tool schema change - add param from no params and test execution", async ({
    page,
  }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    // First remove all params from test_simple_text
    const content = await readConformanceFile();
    const newContent = content.replace(
      `schema: z.object({
      message: z.string().optional(),
    }),`,
      `schema: z.object({}),`
    );
    await writeConformanceFile(newContent);
    await waitForHMRReload(page);

    await page.getByTestId("tool-item-test_simple_text").click();
    await expect(page.getByTestId("tool-param-message")).not.toBeVisible({
      timeout: 5000,
    });

    // Now add a new parameter
    const updatedContent = newContent.replace(
      `schema: z.object({}),`,
      `schema: z.object({
      greeting: z.string().optional().describe("Greeting message"),
    }),`
    );
    await writeConformanceFile(updatedContent);
    await waitForHMRReload(page);

    const greetingInput = page.getByTestId("tool-param-greeting");
    await expect(greetingInput).toBeVisible({ timeout: 10000 });

    // Test execution with newly added parameter
    await greetingInput.fill("Hello HMR");
    await page.getByTestId("tool-execution-execute-button").click();
    await expect(page.getByText(/Echo:/)).toBeVisible({ timeout: 5000 });
  });

  test("blank server - tools list empty then add tool via HMR", async ({
    page,
  }) => {
    originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

    const minimalServer = `/**
 * Minimal server for HMR blank test
 */
import { MCPServer, text } from "mcp-use/server";

const server = new MCPServer({
  name: "ConformanceTestServer",
  version: "1.0.0",
  description: "Minimal for HMR test",
});

await server.listen();
`;
    await writeConformanceFile(minimalServer);
    await waitForHMRReload(page);

    await expect(
      page.getByTestId("tool-item-test_simple_text")
    ).not.toBeVisible({
      timeout: 10000,
    });

    const addToolContent = `/**
 * Minimal server for HMR blank test
 */
import { MCPServer, text } from "mcp-use/server";

const server = new MCPServer({
  name: "ConformanceTestServer",
  version: "1.0.0",
  description: "Minimal for HMR test",
});

server.tool(
  { name: "hmr-blank-tool", description: "Added on blank server" },
  async () => text("Blank HMR works!")
);

await server.listen();
`;
    await writeConformanceFile(addToolContent);
    await waitForHMRReload(page);

    await expect(page.getByTestId("tool-item-hmr-blank-tool")).toBeVisible({
      timeout: 10000,
    });
  });

  test("widget content change - updated text visible in Apps SDK and MCP Apps after HMR", async ({
    page,
  }) => {
    originalWidgetContent = await backupFile(CONFORMANCE_WEATHER_WIDGET_PATH);

    // Execute the tool once
    await page.getByTestId("tool-item-get-weather-delayed").click();
    await page.getByTestId("tool-param-city").fill("tokyo");
    await page.getByTestId("tool-param-delay").fill("1500");
    await page.getByTestId("tool-execution-execute-button").click();

    // Verify original text in Apps SDK
    await expect(page.getByTestId("tool-result-view-chatgpt-app")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("tool-result-view-chatgpt-app").click();
    const appsSdkFrame = page.frameLocator(
      'iframe[title^="OpenAI Component: get-weather-delayed"]'
    );
    await expect(appsSdkFrame.getByText("Host Context Settings")).toBeVisible({
      timeout: 8000,
    });

    // Verify original text in MCP Apps
    await page.getByTestId("tool-result-view-mcp-apps").click();
    const mcpAppsOuter = page.frameLocator(
      'iframe[title^="MCP App: get-weather-delayed"]'
    );
    const mcpAppsGuest = mcpAppsOuter.frameLocator("iframe");
    await expect(mcpAppsGuest.getByText("Host Context Settings")).toBeVisible({
      timeout: 5000,
    });

    // Update widget content and wait for HMR to reload the widget
    const content = await readConformanceFile(CONFORMANCE_WEATHER_WIDGET_PATH);
    const newContent = content.replace(
      "Host Context Settings",
      "Host Context Settings Updated"
    );
    await writeConformanceFile(newContent, CONFORMANCE_WEATHER_WIDGET_PATH);
    await waitForHMRReload(page, { minMs: 3000 });

    // Verify updated text appears live in Apps SDK (without re-executing)
    await page.getByTestId("tool-result-view-chatgpt-app").click();
    await expect(
      appsSdkFrame.getByText("Host Context Settings Updated")
    ).toBeVisible({
      timeout: 8000,
    });

    // Verify updated text appears live in MCP Apps (without re-executing)
    await page.getByTestId("tool-result-view-mcp-apps").click();
    await expect(
      mcpAppsGuest.getByText("Host Context Settings Updated")
    ).toBeVisible({
      timeout: 5000,
    });
  });

  test("widget metadata preserved after HMR - dual protocol still works", async ({
    page,
  }) => {
    originalWidgetContent = await backupFile(CONFORMANCE_WEATHER_WIDGET_PATH);

    const content = await readConformanceFile(CONFORMANCE_WEATHER_WIDGET_PATH);
    const newContent = content.replace(
      "Interactive weather card showing temperature and conditions",
      "Interactive weather card (HMR metadata test)"
    );
    await writeConformanceFile(newContent, CONFORMANCE_WEATHER_WIDGET_PATH);
    await waitForHMRReload(page, { minMs: 3000 });

    await page.getByTestId("tool-item-get-weather-delayed").click();
    await page.getByTestId("tool-param-city").fill("tokyo");
    await page.getByTestId("tool-param-delay").fill("1500");
    await page.getByTestId("tool-execution-execute-button").click();

    await expect(page.getByTestId("tool-result-maximize")).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId("tool-result-view-chatgpt-app").click();
    const appsSdkFrame = page.frameLocator(
      'iframe[title^="OpenAI Component: get-weather-delayed"]'
    );
    await expect(appsSdkFrame.getByText(/tokyo/i)).toBeVisible({
      timeout: 8000,
    });
    await expect(appsSdkFrame.getByText("Partly Cloudy")).toBeVisible();
    await expect(appsSdkFrame.getByText(/22/)).toBeVisible();

    await page.getByTestId("tool-result-view-mcp-apps").click();
    const mcpAppsOuter = page.frameLocator(
      'iframe[title^="MCP App: get-weather-delayed"]'
    );
    const mcpAppsGuest = mcpAppsOuter.frameLocator("iframe");
    await expect(mcpAppsGuest.getByText(/tokyo/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(mcpAppsGuest.getByText("Partly Cloudy")).toBeVisible();
    await expect(mcpAppsGuest.getByText(/22/)).toBeVisible();
  });

  // ==========================================================================
  // HMR - Prompts
  // ==========================================================================

  test.describe("HMR - Prompts", () => {
    test("prompt addition - new prompt appears in UI after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const hmrPromptSnippet = `
server.prompt(
  { name: "hmr-test-prompt", description: "Added via HMR" },
  async () => text("HMR prompt works!")
);
`;
      const newContent = content.replace(
        "await server.listen();",
        `${hmrPromptSnippet}\nawait server.listen();`
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Prompts/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Prompts" })
      ).toBeVisible();

      await expect(page.getByTestId("prompt-item-hmr-test-prompt")).toBeVisible(
        { timeout: 10000 }
      );

      await page.getByTestId("prompt-item-hmr-test-prompt").click();
      await page.getByTestId("prompt-execute-button").click();
      await expect(page.getByText("HMR prompt works!")).toBeVisible({
        timeout: 5000,
      });
    });

    test("prompt removal - prompt disappears from UI after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const promptBlock = `// prompts-get-simple (no args required)
server.prompt(
  {
    name: "test_simple_prompt",
    description: "A simple prompt without arguments",
  },
  async () => text("This is a simple prompt without any arguments.")
);

`;
      const newContent = content.replace(
        promptBlock,
        "// test_simple_prompt removed for HMR test\n\n"
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Prompts/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Prompts" })
      ).toBeVisible();

      await expect(
        page.getByTestId("prompt-item-test_simple_prompt")
      ).not.toBeVisible({ timeout: 10000 });
    });

    test("prompt metadata change - description updates in UI after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        'description: "A simple prompt without arguments"',
        'description: "Updated via HMR - new description"'
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Prompts/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Prompts" })
      ).toBeVisible();

      const promptItem = page.getByTestId("prompt-item-test_simple_prompt");
      await expect(
        promptItem.getByText("Updated via HMR - new description")
      ).toBeVisible({ timeout: 10000 });

      // Verify description also appears in execution panel after clicking
      await promptItem.click();

      // Execute to verify the prompt still works after HMR
      await page.getByTestId("prompt-execute-button").click();
      await expect(
        page.getByText("This is a simple prompt without any arguments.")
      ).toBeVisible({ timeout: 5000 });
    });

    test("prompt schema change - add parameter and test execution after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        `server.prompt(
  {
    name: "test_simple_prompt",
    description: "A simple prompt without arguments",
  },
  async () => text("This is a simple prompt without any arguments.")
)`,
        `server.prompt(
  {
    name: "test_simple_prompt",
    description: "A simple prompt without arguments",
    schema: z.object({
      message: z.string().optional(),
    }),
  },
  async ({ message = "default" }) => text(\`Simple prompt: \${message}\`)
)`
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Prompts/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Prompts" })
      ).toBeVisible();

      await page.getByTestId("prompt-item-test_simple_prompt").click();
      await expect(page.getByTestId("prompt-param-message")).toBeVisible({
        timeout: 10000,
      });

      await page.getByTestId("prompt-param-message").fill("HMR param test");
      await page.getByTestId("prompt-execute-button").click();
      await expect(page.getByText("Simple prompt: HMR param test")).toBeVisible(
        { timeout: 5000 }
      );
    });

    test("prompt schema change - remove parameter and test execution after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        `server.prompt(
  {
    name: "test_prompt_with_arguments",
    description: "A prompt that accepts arguments",
    schema: z.object({
      arg1: completable(z.string().optional(), () => {
        return ["default1"];
      }),
      arg2: completable(z.string().optional(), () => {
        return ["default2"];
      }),
    }),
  },
  async ({ arg1 = "default1", arg2 = "default2" }) =>
    text(\`Prompt with arguments: arg1='\${arg1}', arg2='\${arg2}'\`)
)`,
        `server.prompt(
  {
    name: "test_prompt_with_arguments",
    description: "A prompt that accepts arguments",
    schema: z.object({}),
  },
  async () => text("Prompt with no args after HMR")
)`
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Prompts/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Prompts" })
      ).toBeVisible();

      await page.getByTestId("prompt-item-test_prompt_with_arguments").click();
      await expect(page.getByTestId("prompt-param-arg1")).not.toBeVisible({
        timeout: 5000,
      });

      await page.getByTestId("prompt-execute-button").click();
      await expect(page.getByText("Prompt with no args after HMR")).toBeVisible(
        { timeout: 5000 }
      );
    });

    test("prompt schema change - make parameter required and test execution after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        `schema: z.object({
      arg1: completable(z.string().optional(), () => {
        return ["default1"];
      }),
      arg2: completable(z.string().optional(), () => {
        return ["default2"];
      }),
    }),`,
        `schema: z.object({
      arg1: z.string().describe("Required arg1"),
      arg2: z.string().optional(),
    }),`
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Prompts/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Prompts" })
      ).toBeVisible();

      await page.getByTestId("prompt-item-test_prompt_with_arguments").click();
      const arg1Input = page.getByTestId("prompt-param-arg1");
      await expect(arg1Input).toBeVisible({ timeout: 10000 });

      await arg1Input.fill("HMR required");
      await page.getByTestId("prompt-execute-button").click();
      await expect(page.getByText("arg1='HMR required'")).toBeVisible({
        timeout: 5000,
      });
    });

    test("prompt content change - updated response visible after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        'text("This is a simple prompt without any arguments.")',
        'text("HMR updated content")'
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Prompts/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Prompts" })
      ).toBeVisible();

      await page.getByTestId("prompt-item-test_simple_prompt").click();
      await page.getByTestId("prompt-execute-button").click();
      await expect(page.getByText("HMR updated content")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  // ==========================================================================
  // HMR - Resources
  // ==========================================================================

  test.describe("HMR - Resources", () => {
    test("resource addition - new resource appears in UI after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const hmrResourceSnippet = `
server.resource(
  {
    name: "hmr-test-resource",
    uri: "test://hmr",
    title: "HMR Test Resource",
    description: "Added via HMR",
  },
  async () => text("HMR resource works!")
);
`;
      const newContent = content.replace(
        "await server.listen();",
        `${hmrResourceSnippet}\nawait server.listen();`
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Resources/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Resources" })
      ).toBeVisible();

      await expect(
        page.getByTestId("resource-item-hmr-test-resource")
      ).toBeVisible({ timeout: 10000 });

      await page.getByTestId("resource-item-hmr-test-resource").click();
      await expect(page.getByText("HMR resource works!")).toBeVisible({
        timeout: 5000,
      });
    });

    test("resource removal - resource disappears from UI after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const resourceBlock = `// resources-read-text
server.resource(
  {
    name: "static_text",
    uri: "test://static-text",
    title: "Static Text Resource",
    description: "A static text resource",
  },
  async () => text("This is static text content")
);

`;
      const newContent = content.replace(
        resourceBlock,
        "// static_text removed for HMR test\n\n"
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Resources/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Resources" })
      ).toBeVisible();

      await expect(
        page.getByTestId("resource-item-static_text")
      ).not.toBeVisible({ timeout: 10000 });
    });

    test("resource metadata change - title updates in UI after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        'title: "Static Text Resource"',
        'title: "Updated via HMR - new title"'
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Resources/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Resources" })
      ).toBeVisible();

      const resourceItem = page.getByTestId("resource-item-static_text");
      await expect(resourceItem).toBeVisible({ timeout: 10000 });
      await resourceItem.click();
      await expect(page.getByText("This is static text content")).toBeVisible({
        timeout: 5000,
      });
    });

    test("resource metadata change - description updates in UI after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        'description: "A static text resource"',
        'description: "HMR updated description"'
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Resources/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Resources" })
      ).toBeVisible();

      const resourceItem = page.getByTestId("resource-item-static_text");
      await expect(
        resourceItem.getByText("HMR updated description")
      ).toBeVisible({ timeout: 10000 });
    });

    test("resource metadata change - add mimeType and verify still works after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        `{
    name: "static_text",
    uri: "test://static-text",
    title: "Static Text Resource",
    description: "A static text resource",
  }`,
        `{
    name: "static_text",
    uri: "test://static-text",
    title: "Static Text Resource",
    description: "A static text resource",
    mimeType: "text/plain",
  }`
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Resources/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Resources" })
      ).toBeVisible();

      await page.getByTestId("resource-item-static_text").click();
      await expect(page.getByText("This is static text content")).toBeVisible({
        timeout: 5000,
      });
    });

    test("resource content change - text updates in UI after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        'text("This is static text content")',
        'text("HMR updated resource content")'
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Resources/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Resources" })
      ).toBeVisible();

      await page.getByTestId("resource-item-static_text").click();
      await expect(page.getByText("HMR updated resource content")).toBeVisible({
        timeout: 5000,
      });
    });

    test("resource URI change - resource still appears and works after HMR", async ({
      page,
    }) => {
      originalServerContent = await backupFile(CONFORMANCE_SERVER_PATH);

      const content = await readConformanceFile();
      const newContent = content.replace(
        'uri: "test://static-text"',
        'uri: "test://static-text-updated"'
      );
      await writeConformanceFile(newContent);
      await waitForHMRReload(page);

      await page
        .getByRole("tab", { name: /Resources/ })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Resources" })
      ).toBeVisible();

      await expect(page.getByTestId("resource-item-static_text")).toBeVisible({
        timeout: 10000,
      });

      await page.getByTestId("resource-item-static_text").click();
      await expect(page.getByText("This is static text content")).toBeVisible({
        timeout: 5000,
      });
    });
  });
});
