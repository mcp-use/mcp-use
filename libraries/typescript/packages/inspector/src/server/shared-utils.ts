import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared utilities for MCP Inspector server functionality
 */

interface LLMConfig {
  provider: "openai" | "anthropic";
  model: string;
  apiKey: string;
  temperature?: number;
}

interface OAuthTokens {
  access_token: string;
  token_type?: string;
  [key: string]: unknown;
}

interface AuthConfig {
  type?: string;
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  username?: string;
  password?: string;
  token?: string;
  oauthTokens?: OAuthTokens;
  [key: string]: unknown;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

// Type for LangChain LLM models - using any for flexibility with dynamic imports

type BaseLLM = any;

interface ServerConfig {
  url: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Handle chat API request with MCP agent (streaming)
 */
export async function* handleChatRequestStream(requestBody: {
  mcpServerUrl: string;
  llmConfig: LLMConfig;
  authConfig?: AuthConfig;
  messages: ChatMessage[];
}): AsyncGenerator<string, void, void> {
  const { mcpServerUrl, llmConfig, authConfig, messages } = requestBody;

  if (!mcpServerUrl || !llmConfig || !messages) {
    throw new Error(
      "Missing required fields: mcpServerUrl, llmConfig, messages"
    );
  }

  // Dynamically import mcp-use and LLM providers
  const { MCPAgent, MCPClient } = await import("mcp-use");

  // Create LLM instance based on provider
  let llm: BaseLLM;
  if (llmConfig.provider === "openai") {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatOpenAI } = await import("@langchain/openai");
    llm = new ChatOpenAI({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    });
  } else if (llmConfig.provider === "anthropic") {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatAnthropic } = await import("@langchain/anthropic");
    llm = new ChatAnthropic({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    });
  } else if (llmConfig.provider === "google") {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
    llm = new ChatGoogleGenerativeAI({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    });
  } else {
    throw new Error(`Unsupported LLM provider: ${llmConfig.provider}`);
  }

  // Create MCP client and connect to server
  const client = new MCPClient();
  const serverName = `inspector-${Date.now()}`;

  // Add server with potential authentication headers
  const serverConfig: ServerConfig = { url: mcpServerUrl };

  // Handle authentication - support both custom auth and OAuth
  if (authConfig && authConfig.type !== "none") {
    serverConfig.headers = {};

    if (
      authConfig.type === "basic" &&
      authConfig.username &&
      authConfig.password
    ) {
      const auth = Buffer.from(
        `${authConfig.username}:${authConfig.password}`
      ).toString("base64");
      serverConfig.headers.Authorization = `Basic ${auth}`;
    } else if (authConfig.type === "bearer" && authConfig.token) {
      serverConfig.headers.Authorization = `Bearer ${authConfig.token}`;
    } else if (authConfig.type === "oauth") {
      // For OAuth, use the tokens passed from the frontend
      if (authConfig.oauthTokens?.access_token) {
        const tokenType = authConfig.oauthTokens.token_type
          ? authConfig.oauthTokens.token_type.charAt(0).toUpperCase() +
            authConfig.oauthTokens.token_type.slice(1)
          : "Bearer";
        serverConfig.headers.Authorization = `${tokenType} ${authConfig.oauthTokens.access_token}`;
      }
    }
  }

  // If the URL contains authentication info, extract it (fallback)
  try {
    const url = new URL(mcpServerUrl);
    if (
      url.username &&
      url.password &&
      (!authConfig || authConfig.type === "none")
    ) {
      const auth = Buffer.from(`${url.username}:${url.password}`).toString(
        "base64"
      );
      serverConfig.headers = serverConfig.headers || {};
      serverConfig.headers.Authorization = `Basic ${auth}`;
      serverConfig.url = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    }
  } catch (error) {
    console.warn("Failed to parse MCP server URL for auth:", error);
  }

  client.addServer(serverName, serverConfig);

  // Create agent with user's LLM
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 10,
    memoryEnabled: true,
    systemPrompt:
      "You are a helpful assistant with access to MCP tools, prompts, and resources. Help users interact with the MCP server.",
  });

  // Format messages - use only the last user message as the query
  const lastUserMessage = messages
    .filter((msg: any) => msg.role === "user")
    .pop();

  if (!lastUserMessage) {
    throw new Error("No user message found");
  }

  try {
    // Generate a unique message ID
    const messageId = `msg-${Date.now()}`;

    // Send initial assistant message event (AI SDK format)
    yield `data: ${JSON.stringify({ type: "message", id: messageId, role: "assistant" })}\n\n`;

    // Use streamEvents to get real-time updates
    for await (const event of agent.streamEvents(lastUserMessage.content)) {
      // Emit text content as it streams
      if (event.event === "on_chat_model_stream" && event.data?.chunk?.text) {
        const text = event.data.chunk.text;
        if (typeof text === "string" && text.length > 0) {
          // AI SDK text event format
          yield `data: ${JSON.stringify({ type: "text", id: messageId, content: text })}\n\n`;
        }
      } else if (event.event === "on_tool_start") {
        // Tool invocation started - AI SDK tool-call event
        const toolCallId = `tool-${event.name}-${Date.now()}`;
        yield `data: ${JSON.stringify({
          type: "tool-call",
          id: messageId,
          toolCallId,
          toolName: event.name,
          args: event.data?.input || {},
        })}\n\n`;
      } else if (event.event === "on_tool_end") {
        // Tool invocation completed - AI SDK tool-result event
        const toolCallId = `tool-${event.name}-${Date.now()}`;
        yield `data: ${JSON.stringify({
          type: "tool-result",
          id: messageId,
          toolCallId,
          toolName: event.name,
          result: event.data?.output,
        })}\n\n`;
      }
    }

    // Send final done event
    yield `data: ${JSON.stringify({ type: "done", id: messageId })}\n\n`;
  } finally {
    // Clean up
    await client.closeAllSessions();
  }
}

/**
 * Handle chat API request with MCP agent (non-streaming, kept for backwards compatibility)
 */
export async function handleChatRequest(requestBody: {
  mcpServerUrl: string;
  llmConfig: LLMConfig;
  authConfig?: AuthConfig;
  messages: ChatMessage[];
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const { mcpServerUrl, llmConfig, authConfig, messages } = requestBody;

  if (!mcpServerUrl || !llmConfig || !messages) {
    throw new Error(
      "Missing required fields: mcpServerUrl, llmConfig, messages"
    );
  }

  // Dynamically import mcp-use and LLM providers
  const { MCPAgent, MCPClient } = await import("mcp-use");

  // Create LLM instance based on provider
  let llm: BaseLLM;
  if (llmConfig.provider === "openai") {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatOpenAI } = await import("@langchain/openai");
    llm = new ChatOpenAI({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    });
  } else if (llmConfig.provider === "anthropic") {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatAnthropic } = await import("@langchain/anthropic");
    llm = new ChatAnthropic({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    });
  } else if (llmConfig.provider === "google") {
    // @ts-ignore - Dynamic import of peer dependency available through mcp-use
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
    llm = new ChatGoogleGenerativeAI({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
    });
  } else {
    throw new Error(`Unsupported LLM provider: ${llmConfig.provider}`);
  }

  // Create MCP client and connect to server
  const client = new MCPClient();
  const serverName = `inspector-${Date.now()}`;

  // Add server with potential authentication headers
  const serverConfig: ServerConfig = { url: mcpServerUrl };

  // Handle authentication - support both custom auth and OAuth
  if (authConfig && authConfig.type !== "none") {
    serverConfig.headers = {};

    if (
      authConfig.type === "basic" &&
      authConfig.username &&
      authConfig.password
    ) {
      const auth = Buffer.from(
        `${authConfig.username}:${authConfig.password}`
      ).toString("base64");
      serverConfig.headers.Authorization = `Basic ${auth}`;
    } else if (authConfig.type === "bearer" && authConfig.token) {
      serverConfig.headers.Authorization = `Bearer ${authConfig.token}`;
    } else if (authConfig.type === "oauth") {
      // For OAuth, use the tokens passed from the frontend
      if (authConfig.oauthTokens?.access_token) {
        // Capitalize the token type (e.g., "bearer" -> "Bearer")
        const tokenType = authConfig.oauthTokens.token_type
          ? authConfig.oauthTokens.token_type.charAt(0).toUpperCase() +
            authConfig.oauthTokens.token_type.slice(1)
          : "Bearer";
        serverConfig.headers.Authorization = `${tokenType} ${authConfig.oauthTokens.access_token}`;
        console.log("Using OAuth access token for MCP server authentication");
        console.log(
          "Authorization header:",
          `${tokenType} ${authConfig.oauthTokens.access_token.substring(0, 20)}...`
        );
      } else {
        console.warn("OAuth selected but no access token provided");
      }
    }
  }

  // If the URL contains authentication info, extract it (fallback)
  try {
    const url = new URL(mcpServerUrl);
    if (
      url.username &&
      url.password &&
      (!authConfig || authConfig.type === "none")
    ) {
      // Extract auth from URL
      const auth = Buffer.from(`${url.username}:${url.password}`).toString(
        "base64"
      );
      serverConfig.headers = serverConfig.headers || {};
      serverConfig.headers.Authorization = `Basic ${auth}`;
      // Remove auth from URL to avoid double encoding
      serverConfig.url = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    }
  } catch (error) {
    // If URL parsing fails, use original URL
    console.warn("Failed to parse MCP server URL for auth:", error);
  }

  // Debug: Log the server config being used
  console.log("Adding server with config:", {
    url: serverConfig.url,
    hasHeaders: !!serverConfig.headers,
    headers: serverConfig.headers,
  });

  client.addServer(serverName, serverConfig);

  // Create agent with user's LLM
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 10,
    memoryEnabled: true,
    systemPrompt:
      "You are a helpful assistant with access to MCP tools, prompts, and resources. Help users interact with the MCP server.",
  });

  // Format messages - use only the last user message as the query
  const lastUserMessage = messages
    .filter((msg: any) => msg.role === "user")
    .pop();

  if (!lastUserMessage) {
    throw new Error("No user message found");
  }

  // Get response from agent
  const response = await agent.run(lastUserMessage.content);

  // Clean up
  await client.closeAllSessions();

  return {
    content: response,
    toolCalls: [],
  };
}

/**
 * Get content type for static assets
 */
export function getContentType(filePath: string): string {
  if (filePath.endsWith(".js")) {
    return "application/javascript";
  } else if (filePath.endsWith(".css")) {
    return "text/css";
  } else if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  } else if (filePath.endsWith(".html")) {
    return "text/html";
  } else if (filePath.endsWith(".json")) {
    return "application/json";
  } else if (filePath.endsWith(".png")) {
    return "image/png";
  } else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
    return "image/jpeg";
  } else if (filePath.endsWith(".ico")) {
    return "image/x-icon";
  } else {
    return "application/octet-stream";
  }
}

/**
 * Check if client files exist
 */
export function checkClientFiles(clientDistPath: string): boolean {
  return existsSync(clientDistPath);
}

/**
 * Get client dist path
 * Returns different paths depending on whether running from CLI or server
 */
export function getClientDistPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Check if we're running from dist/cli.js or dist/server/*.js
  // CLI: dist/cli.js -> path is './client'
  // Server: dist/server/*.js -> path is '../client'
  if (__dirname.endsWith("dist") || __dirname.endsWith("dist/")) {
    // Running from CLI (dist/cli.js)
    return join(__dirname, "client");
  }

  // Running from server (dist/server/*.js)
  return join(__dirname, "../client");
}

/**
 * Widget data storage
 */
export interface WidgetData {
  serverId: string;
  uri: string;
  toolInput: Record<string, any>;
  toolOutput: any;
  resourceData: any;
  toolId: string;
  timestamp: number;
  widgetCSP?: {
    connect_domains?: string[];
    resource_domains?: string[];
  };
  devWidgetUrl?: string;
  devServerBaseUrl?: string;
  theme?: "light" | "dark";
}

const widgetDataStore = new Map<string, WidgetData>();

// Cleanup expired widget data every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    for (const [toolId, data] of widgetDataStore.entries()) {
      if (now - data.timestamp > ONE_HOUR) {
        widgetDataStore.delete(toolId);
      }
    }
  },
  5 * 60 * 1000
).unref();

/**
 * Store widget data for rendering
 */
export function storeWidgetData(data: Omit<WidgetData, "timestamp">): {
  success: boolean;
  error?: string;
} {
  const {
    serverId,
    uri,
    toolInput,
    toolOutput,
    resourceData,
    toolId,
    widgetCSP: _widgetCSP,
    devWidgetUrl,
    devServerBaseUrl,
  } = data;

  console.log("[Widget Store] Received request for toolId:", toolId);
  console.log("[Widget Store] Fields:", {
    serverId,
    uri,
    hasResourceData: !!resourceData,
    hasToolInput: !!toolInput,
    hasToolOutput: !!toolOutput,
    hasWidgetCSP: !!_widgetCSP,
    devWidgetUrl,
    devServerBaseUrl,
  });

  if (!serverId || !uri || !toolId || !resourceData) {
    const missingFields = [];
    if (!serverId) missingFields.push("serverId");
    if (!uri) missingFields.push("uri");
    if (!toolId) missingFields.push("toolId");
    if (!resourceData) missingFields.push("resourceData");

    console.error("[Widget Store] Missing required fields:", missingFields);
    return {
      success: false,
      error: `Missing required fields: ${missingFields.join(", ")}`,
    };
  }

  // Store widget data using toolId as key
  widgetDataStore.set(toolId, {
    serverId,
    uri,
    toolInput,
    toolOutput,
    resourceData,
    toolId,
    timestamp: Date.now(),
    widgetCSP: _widgetCSP,
    devWidgetUrl,
    devServerBaseUrl,
  });

  console.log("[Widget Store] Data stored successfully for toolId:", toolId);
  return { success: true };
}

/**
 * Get widget data by toolId
 */
export function getWidgetData(toolId: string): WidgetData | undefined {
  return widgetDataStore.get(toolId);
}

/**
 * Generate widget container HTML
 */
export function generateWidgetContainerHtml(
  basePath: string,
  toolId: string
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Loading Widget...</title>
    </head>
    <body>
      <script>
        (async function() {
          try {
            // Change URL to "/" BEFORE loading widget (for React Router)
            history.replaceState(null, '', '/');

            // Fetch the actual widget HTML using toolId
            const response = await fetch('${basePath}/api/resources/widget-content/${toolId}');
            const html = await response.text();

            // Replace entire document with widget HTML using proper method
            document.open();
            // Write the HTML content - the browser will parse it properly
            document.write(html);
            document.close();
          } catch (error) {
            console.error('Failed to load widget:', error);
            document.body.innerHTML = '<div style="padding: 20px; color: red;">Failed to load widget: ' + error.message + '</div>';
          }
        })();
      </script>
    </body>
    </html>
  `;
}

/**
 * Generate widget content HTML with injected OpenAI API
 */
export function generateWidgetContentHtml(widgetData: WidgetData): {
  html: string;
  error?: string;
} {
  const {
    serverId,
    uri,
    toolInput,
    toolOutput,
    resourceData,
    toolId,
    widgetCSP: _widgetCSP,
    devServerBaseUrl,
    theme,
  } = widgetData;

  console.log("[Widget Content] Using pre-fetched resource for:", {
    serverId,
    uri,
  });

  // Extract HTML content from the pre-fetched resource data
  let htmlContent = "";

  // The resourceData was fetched client-side, extract HTML from it
  const contentsArray = Array.isArray(resourceData?.contents)
    ? resourceData.contents
    : [];

  const firstContent = contentsArray[0];
  if (firstContent) {
    if (typeof (firstContent as { text?: unknown }).text === "string") {
      htmlContent = (firstContent as { text: string }).text;
    } else if (typeof (firstContent as { blob?: unknown }).blob === "string") {
      htmlContent = (firstContent as { blob: string }).blob;
    }
  }

  if (!htmlContent && resourceData && typeof resourceData === "object") {
    const recordContent = resourceData as Record<string, unknown>;
    if (typeof recordContent.text === "string") {
      htmlContent = recordContent.text;
    } else if (typeof recordContent.blob === "string") {
      htmlContent = recordContent.blob;
    }
  }

  if (!htmlContent) {
    return { html: "", error: "No HTML content found" };
  }

  const widgetStateKey = `openai-widget-state:${toolId}`;

  // Safely serialize data to avoid script injection issues
  const safeToolInput = JSON.stringify(toolInput ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  const safeToolOutput = JSON.stringify(toolOutput ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  const safeToolId = JSON.stringify(toolId);
  const safeWidgetStateKey = JSON.stringify(widgetStateKey);
  // Safely serialize theme, defaulting to 'light' if not provided
  const safeTheme = JSON.stringify(theme === "dark" ? "dark" : "light");

  // Inject window.openai API script
  const apiScript = `
    <script>
      (function() {
        'use strict';

        // Change URL to "/" for React Router compatibility
        // Skip if running in Inspector dev-widget proxy to prevent redirecting iframe to Inspector home
        if (window.location.pathname !== '/' && !window.location.pathname.includes('/dev-widget/')) {
          history.replaceState(null, '', '/');
        }

        // Inject MCP widget utilities for Image component and file access
        window.__mcpPublicUrl = ${devServerBaseUrl ? `"${devServerBaseUrl}/mcp-use/public"` : '""'};
        window.__getFile = function(filename) {
          return ${devServerBaseUrl ? `"${devServerBaseUrl}/mcp-use/widgets/"` : '""'} + filename;
        };

        const openaiAPI = {
          toolInput: ${safeToolInput},
          toolOutput: ${safeToolOutput},
          toolResponseMetadata: null,
          displayMode: 'inline',
          maxHeight: 600,
          theme: ${safeTheme},
          locale: 'en-US',
          safeArea: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
          userAgent: {},
          widgetState: null,

          async setWidgetState(state) {
            this.widgetState = state;
            try {
              localStorage.setItem(${safeWidgetStateKey}, JSON.stringify(state));
            } catch (err) {
              console.error('[OpenAI Widget] Failed to save widget state:', err);
            }
            window.parent.postMessage({
              type: 'openai:setWidgetState',
              toolId: ${safeToolId},
              state
            }, '*');
          },

          async callTool(toolName, params = {}) {
            return new Promise((resolve, reject) => {
              const requestId = \`tool_\${Date.now()}_\${Math.random()}\`;
              const handler = (event) => {
                if (event.data.type === 'openai:callTool:response' &&
                    event.data.requestId === requestId) {
                  window.removeEventListener('message', handler);
                  if (event.data.error) {
                    reject(new Error(event.data.error));
                  } else {
                    resolve(event.data.result);
                  }
                }
              };
              window.addEventListener('message', handler);
              window.parent.postMessage({
                type: 'openai:callTool',
                requestId,
                toolName,
                params
              }, '*');
              setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error('Tool call timeout'));
              }, 30000);
            });
          },

          async sendFollowupTurn(message) {
            const payload = typeof message === 'string'
              ? { prompt: message }
              : message;
            window.parent.postMessage({
              type: 'openai:sendFollowup',
              message: payload.prompt || payload
            }, '*');
          },

          async requestDisplayMode(options = {}) {
            const mode = options.mode || 'inline';
            this.displayMode = mode;
            window.parent.postMessage({
              type: 'openai:requestDisplayMode',
              mode
            }, '*');
            return { mode };
          },

          async sendFollowUpMessage(args) {
            const prompt = typeof args === 'string' ? args : (args?.prompt || '');
            return this.sendFollowupTurn(prompt);
          },

          openExternal(payload) {
            const href = typeof payload === 'string' ? payload : payload?.href;
            if (href) {
              window.open(href, '_blank', 'noopener,noreferrer');
            }
          }
        };

        Object.defineProperty(window, 'openai', {
          value: openaiAPI,
          writable: false,
          configurable: false,
          enumerable: true
        });

        Object.defineProperty(window, 'webplus', {
          value: openaiAPI,
          writable: false,
          configurable: false,
          enumerable: true
        });

        // Listen for widget state requests from inspector
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'mcp-inspector:getWidgetState') {
            window.parent.postMessage({
              type: 'mcp-inspector:widgetStateResponse',
              toolId: event.data.toolId,
              state: openaiAPI.widgetState
            }, '*');
          }
        });

        setTimeout(() => {
          try {
            const globalsEvent = new CustomEvent('openai:set_globals', {
              detail: {
                globals: {
                  toolInput: openaiAPI.toolInput,
                  toolOutput: openaiAPI.toolOutput,
                  toolResponseMetadata: openaiAPI.toolResponseMetadata || null,
                  widgetState: openaiAPI.widgetState,
                  displayMode: openaiAPI.displayMode,
                  maxHeight: openaiAPI.maxHeight,
                  theme: openaiAPI.theme,
                  locale: openaiAPI.locale,
                  safeArea: openaiAPI.safeArea,
                  userAgent: openaiAPI.userAgent
                }
              }
            });
            window.dispatchEvent(globalsEvent);
          } catch (err) {}
        }, 0);

        setTimeout(() => {
          try {
            const stored = localStorage.getItem(${safeWidgetStateKey});
            if (stored && window.openai) {
              window.openai.widgetState = JSON.parse(stored);
            }
          } catch (err) {}
        }, 0);
      })();
    </script>
  `;

  // Inject script into HTML
  let modifiedHtml;
  if (htmlContent.includes("<html>") && htmlContent.includes("<head>")) {
    // If it's a full HTML document, inject at the beginning of head
    // Preserve any existing base tag instead of commenting it out
    modifiedHtml = htmlContent.replace("<head>", `<head>${apiScript}`);
  } else {
    // Widget HTML is just fragments, wrap it properly
    modifiedHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${apiScript}
  <title>Widget</title>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
  }

  console.log("[Widget Content] Generated HTML length:", modifiedHtml.length);

  return { html: modifiedHtml };
}

/**
 * Get security headers for widget content
 */
export function getWidgetSecurityHeaders(
  widgetCSP?: {
    connect_domains?: string[];
    resource_domains?: string[];
  },
  devServerBaseUrl?: string
): Record<string, string> {
  const trustedCdns = [
    "https://persistent.oaistatic.com",
    "https://*.oaistatic.com",
    "https://unpkg.com",
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
    "https://cdn.skypack.dev",
  ];

  // Merge widget-specific resource domains with trusted CDNs
  const allResourceDomains = [...trustedCdns];
  if (widgetCSP?.resource_domains) {
    allResourceDomains.push(...widgetCSP.resource_domains);
  }

  // Add dev server origin for HMR scripts in development mode
  let devServerOrigin: string | null = null;
  if (devServerBaseUrl) {
    try {
      devServerOrigin = new URL(devServerBaseUrl).origin;
      allResourceDomains.push(devServerOrigin);
    } catch (e) {
      console.warn(`[CSP] Invalid devServerBaseUrl: ${devServerBaseUrl}`);
    }
  }

  const resourceDomainsStr = allResourceDomains.join(" ");

  // Build img-src with dev server origin for images in development mode
  let imgSrc = "'self' data: https: blob:";
  if (devServerOrigin) {
    imgSrc = `'self' data: https: blob: ${devServerOrigin}`;
  }

  // Build media-src with dev server origin for media in development mode
  let mediaSrc = "'self' data: https: blob:";
  if (devServerOrigin) {
    mediaSrc = `'self' data: https: blob: ${devServerOrigin}`;
  }

  // Build connect-src with widget-specific domains
  let connectSrc = "'self' https: wss: ws:";
  if (widgetCSP?.connect_domains && widgetCSP.connect_domains.length > 0) {
    connectSrc = `'self' ${widgetCSP.connect_domains.join(" ")} https: wss: ws:`;
  }

  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${resourceDomainsStr}`,
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      `style-src 'self' 'unsafe-inline' ${resourceDomainsStr}`,
      `img-src ${imgSrc}`,
      `media-src ${mediaSrc}`,
      `font-src 'self' data: ${resourceDomainsStr}`,
      `connect-src ${connectSrc}`,
      "frame-ancestors 'self'",
    ].join("; "),
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}
