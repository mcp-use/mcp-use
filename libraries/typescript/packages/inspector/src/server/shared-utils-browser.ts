/**
 * Browser-compatible utilities for MCP Inspector chat functionality
 * Works in both Node.js and browser environments without Node.js-specific APIs
 */

interface LLMConfig {
  provider: "openai" | "anthropic" | "google";
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

interface MessageAttachment {
  type: "image" | "file";
  data: string; // base64 encoded
  mimeType: string;
  name?: string;
  size?: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: MessageAttachment[];
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
 * Cross-platform base64 encoding utility
 */
function toBase64(str: string): string {
  // Check if we're in a browser environment
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(str);
  }
  // Node.js environment
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str).toString("base64");
  }
  // Fallback - shouldn't reach here in practice
  throw new Error("No base64 encoding method available");
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
  // Note: MCPClient supports multiple servers via client.addServer(name, config)
  // Import from main entry (not browser) since this runs server-side.
  // MCPAgent and MCPClient are both exported from the main "mcp-use" entry point.
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
  // BrowserMCPClient from mcp-use/browser, aliased as MCPClient
  const client = new MCPClient() as any;
  const serverName = `inspector-${Date.now()}`;

  // Add server with potential authentication headers
  const serverConfig: ServerConfig = {
    url: mcpServerUrl,
    preventAutoAuth: true, // Prevent auto OAuth popup - tokens are passed via headers
  };

  // Handle authentication - support both custom auth and OAuth
  if (authConfig && authConfig.type !== "none") {
    serverConfig.headers = {};

    if (
      authConfig.type === "basic" &&
      authConfig.username &&
      authConfig.password
    ) {
      const auth = toBase64(`${authConfig.username}:${authConfig.password}`);
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
      const auth = toBase64(`${url.username}:${url.password}`);
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

  // Convert message to LangChain format (supporting multimodal)
  let messageInput: any;
  if (lastUserMessage.attachments && lastUserMessage.attachments.length > 0) {
    // Multimodal message with attachments
    const { HumanMessage } = await import("@langchain/core/messages");
    const content: Array<any> = [
      {
        type: "text",
        text: lastUserMessage.content || "[no content]",
      },
    ];

    // Add image attachments
    for (const attachment of lastUserMessage.attachments) {
      if (attachment.type === "image") {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${attachment.mimeType};base64,${attachment.data}`,
          },
        });
      }
    }

    messageInput = new HumanMessage({ content });
  } else {
    // Regular text message
    messageInput = lastUserMessage.content;
  }

  try {
    // Generate a unique message ID
    const messageId = `msg-${Date.now()}`;

    // Send initial assistant message event (AI SDK format)
    yield `data: ${JSON.stringify({ type: "message", id: messageId, role: "assistant" })}\n\n`;

    // Use streamEvents to get real-time updates
    for await (const event of agent.streamEvents(messageInput)) {
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
 * Execute a non-streaming chat turn using an MCP agent and the specified LLM configuration.
 *
 * @param requestBody - Request parameters
 * @param requestBody.mcpServerUrl - Base URL of the MCP server to connect to
 * @param requestBody.llmConfig - LLM provider configuration (provider, model, apiKey, etc.)
 * @param requestBody.authConfig - Optional authentication configuration for the MCP server
 * @param requestBody.messages - Array of chat messages; only the last message with role "user" is used as the query
 * @returns An object containing `content` with the agent's response text and `toolCalls` with recorded tool invocations (empty for this non-streaming implementation)
 * @throws If required fields are missing, if the LLM provider is unsupported, or if no user message is found
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
  // Note: MCPClient supports multiple servers via client.addServer(name, config)
  // Import from main entry (not browser) since this runs server-side.
  // MCPAgent and MCPClient are both exported from the main "mcp-use" entry point.
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
  // BrowserMCPClient from mcp-use/browser, aliased as MCPClient
  const client = new MCPClient() as any;
  const serverName = `inspector-${Date.now()}`;

  // Add server with potential authentication headers
  const serverConfig: ServerConfig = {
    url: mcpServerUrl,
    preventAutoAuth: true, // Prevent auto OAuth popup - tokens are passed via headers
  };

  // Handle authentication - support both custom auth and OAuth
  if (authConfig && authConfig.type !== "none") {
    serverConfig.headers = {};

    if (
      authConfig.type === "basic" &&
      authConfig.username &&
      authConfig.password
    ) {
      const auth = toBase64(`${authConfig.username}:${authConfig.password}`);
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
      const auth = toBase64(`${url.username}:${url.password}`);
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

  // Convert message to LangChain format (supporting multimodal)
  let messageInput: any;
  if (lastUserMessage.attachments && lastUserMessage.attachments.length > 0) {
    // Multimodal message with attachments
    const { HumanMessage } = await import("@langchain/core/messages");
    const content: Array<any> = [
      {
        type: "text",
        text: lastUserMessage.content || "[no content]",
      },
    ];

    // Add image attachments
    for (const attachment of lastUserMessage.attachments) {
      if (attachment.type === "image") {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${attachment.mimeType};base64,${attachment.data}`,
          },
        });
      }
    }

    messageInput = new HumanMessage({ content });
  } else {
    // Regular text message
    messageInput = lastUserMessage.content;
  }

  // Get response from agent
  const response = await agent.run(messageInput);

  // Clean up
  await client.closeAllSessions();

  return {
    content: response,
    toolCalls: [],
  };
}

/**
 * Widget data storage
 */
export interface WidgetData {
  serverId: string;
  uri: string;
  toolInput: Record<string, any>;
  toolOutput: any;
  toolResponseMetadata?: Record<string, any>;
  resourceData: any;
  toolId: string;
  timestamp: number;
  widgetCSP?: {
    connect_domains?: string[];
    resource_domains?: string[];
    frame_domains?: string[];
  };
  devWidgetUrl?: string;
  devServerBaseUrl?: string;
  theme?: "light" | "dark";
  // Playground settings for initializing window.openai
  playground?: {
    locale?: string;
    deviceType?: "mobile" | "tablet" | "desktop";
    capabilities?: { hover: boolean; touch: boolean };
    safeAreaInsets?: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
  // MCP Apps (SEP-1865) support
  protocol?: "mcp-apps" | "chatgpt-app";
  toolName?: string;
  mimeType?: string;
  mcpAppsCsp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  };
  mcpAppsPermissions?: {
    camera?: Record<string, never>;
    microphone?: Record<string, never>;
    geolocation?: Record<string, never>;
    clipboardWrite?: Record<string, never>;
  };
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
    toolResponseMetadata,
    resourceData,
    toolId,
    widgetCSP,
    devWidgetUrl,
    devServerBaseUrl,
    theme,
  } = data;

  console.log("[Widget Store] Received request for toolId:", toolId);
  console.log("[Widget Store] Fields:", {
    serverId,
    uri,
    hasResourceData: !!resourceData,
    hasToolInput: !!toolInput,
    hasToolOutput: !!toolOutput,
    hasToolResponseMetadata: !!toolResponseMetadata,
    toolResponseMetadata,
    hasWidgetCSP: !!widgetCSP,
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
    toolResponseMetadata,
    resourceData,
    toolId,
    timestamp: Date.now(),
    widgetCSP,
    devWidgetUrl,
    devServerBaseUrl,
    theme,
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
            //history.replaceState(null, '', '/');

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
    toolResponseMetadata,
    resourceData,
    toolId,
    devServerBaseUrl,
    theme,
    playground,
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
  const safeToolResponseMetadata = JSON.stringify(toolResponseMetadata ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  const safeToolId = JSON.stringify(toolId);
  const safeWidgetStateKey = JSON.stringify(widgetStateKey);
  // Safely serialize theme, defaulting to 'light' if not provided
  const safeTheme = JSON.stringify(theme === "dark" ? "dark" : "light");

  // Use playground values with fallbacks to defaults
  const locale = playground?.locale || "en-US";
  const deviceType = playground?.deviceType || "desktop";
  const capabilities = playground?.capabilities || {
    hover: true,
    touch: false,
  };
  const safeAreaInsets = playground?.safeAreaInsets || {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  // Serialize playground values for injection
  const safeLocale = JSON.stringify(locale);
  const safeUserAgent = JSON.stringify({
    device: { type: deviceType },
    capabilities,
  });
  const safeSafeArea = JSON.stringify({ insets: safeAreaInsets });

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
          toolResponseMetadata: ${safeToolResponseMetadata},
          displayMode: 'inline',
          maxHeight: 600,
          theme: ${safeTheme},
          locale: ${safeLocale},
          safeArea: ${safeSafeArea},
          userAgent: ${safeUserAgent},
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

          async notifyIntrinsicHeight(height) {
            console.log('[OpenAI Widget] notifyIntrinsicHeight called with:', height);
            if (typeof height !== 'number' || height < 0) {
              console.error('[OpenAI Widget] Invalid height value:', height);
              throw new Error('Height must be a non-negative number');
            }
            const message = {
              type: 'openai:notifyIntrinsicHeight',
              height
            };
            console.log('[OpenAI Widget] Sending postMessage to parent:', message);
            window.parent.postMessage(message, '*');
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

        // Listen for widget state requests from inspector
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'mcp-inspector:getWidgetState') {
            window.parent.postMessage({
              type: 'mcp-inspector:widgetStateResponse',
              toolId: event.data.toolId,
              state: openaiAPI.widgetState
            }, '*');
            return;
          }
        });

        // Listen for globals changes from parent (for displayMode, theme, etc.)
        window.addEventListener('message', (event) => {
          // Handle new general globalsChanged message
          if (event.data?.type === 'openai:globalsChanged') {
            const updates = event.data.updates || {};
            let hasChanges = false;

            // Update displayMode
            if (updates.displayMode && ['inline', 'pip', 'fullscreen'].includes(updates.displayMode)) {
              openaiAPI.displayMode = updates.displayMode;
              hasChanges = true;
            }

            // Update theme
            if (updates.theme && ['light', 'dark'].includes(updates.theme)) {
              openaiAPI.theme = updates.theme;
              hasChanges = true;
            }

            // Update maxHeight
            if (updates.maxHeight !== undefined && typeof updates.maxHeight === 'number') {
              openaiAPI.maxHeight = updates.maxHeight;
              hasChanges = true;
            }

            // Update locale
            if (updates.locale && typeof updates.locale === 'string') {
              openaiAPI.locale = updates.locale;
              hasChanges = true;
            }

            // Update safeArea
            if (updates.safeArea && typeof updates.safeArea === 'object') {
              openaiAPI.safeArea = updates.safeArea;
              hasChanges = true;
            }

            // Update userAgent
            if (updates.userAgent !== undefined) {
              openaiAPI.userAgent = updates.userAgent;
              hasChanges = true;
            }

            // Dispatch set_globals event to notify React components if any changes occurred
            if (hasChanges) {
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
            }
          }
          // Handle legacy displayModeChanged message for backward compatibility
          else if (event.data?.type === 'openai:displayModeChanged') {
            const newMode = event.data.mode;
            if (newMode && ['inline', 'pip', 'fullscreen'].includes(newMode)) {
              openaiAPI.displayMode = newMode;
              // Dispatch set_globals event to notify React components
              try {
                const globalsEvent = new CustomEvent('openai:set_globals', {
                  detail: {
                    globals: {
                      toolInput: openaiAPI.toolInput,
                      toolOutput: openaiAPI.toolOutput,
                      toolResponseMetadata: openaiAPI.toolResponseMetadata || null,
                      widgetState: openaiAPI.widgetState,
                      displayMode: newMode,
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
            }
          }
        });

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
  if (htmlContent.includes("<html") && htmlContent.includes("<head")) {
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
 * Transform MCP Apps camelCase CSP to snake_case for existing header builder
 *
 * MCP Apps (SEP-1865) uses camelCase (connectDomains, resourceDomains)
 * ChatGPT Apps SDK uses snake_case (connect_domains, resource_domains)
 *
 * @param mcpAppsCsp - MCP Apps CSP configuration with camelCase keys
 * @returns ChatGPT-compatible CSP configuration with snake_case keys
 */
export function transformMcpAppsCspToSnakeCase(mcpAppsCsp?: {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}):
  | {
      connect_domains?: string[];
      resource_domains?: string[];
      frame_domains?: string[];
    }
  | undefined {
  if (!mcpAppsCsp) return undefined;

  const result: {
    connect_domains?: string[];
    resource_domains?: string[];
    frame_domains?: string[];
  } = {};

  if (mcpAppsCsp.connectDomains) {
    result.connect_domains = mcpAppsCsp.connectDomains;
  }
  if (mcpAppsCsp.resourceDomains) {
    result.resource_domains = mcpAppsCsp.resourceDomains;
  }
  if (mcpAppsCsp.frameDomains) {
    result.frame_domains = mcpAppsCsp.frameDomains;
  }
  // Note: baseUriDomains is MCP Apps-specific, not in ChatGPT CSP

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Get security headers for widget content
 */
export function getWidgetSecurityHeaders(
  widgetCSP?: {
    connect_domains?: string[];
    resource_domains?: string[];
    frame_domains?: string[];
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
    "https://*.openai.com",
  ];

  // Merge widget-specific resource domains with trusted CDNs (production CSP)
  const prodResourceDomains = [...trustedCdns];
  if (widgetCSP?.resource_domains) {
    prodResourceDomains.push(...widgetCSP.resource_domains);
  }
  const prodResourceDomainsStr = prodResourceDomains.join(" ");

  // Add dev server origin for HMR scripts in development mode
  let devServerOrigin: string | null = null;
  const allResourceDomains = [...prodResourceDomains];
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

  // Build font-src - allow all http/https in dev mode for maximum compatibility
  let fontSrc = `'self' data: ${resourceDomainsStr}`;
  if (devServerOrigin) {
    fontSrc = `'self' data: https: http: ${resourceDomainsStr}`;
  }

  // Build connect-src with widget-specific domains
  let connectSrc = "'self' https: wss: ws:";
  if (widgetCSP?.connect_domains && widgetCSP.connect_domains.length > 0) {
    connectSrc = `'self' ${widgetCSP.connect_domains.join(" ")} https: wss: ws:`;
  }

  // Build frame-src for embedding iframes (e.g., Cal.com embed)
  // Use frame_domains if specified (per OpenAI spec), fall back to resource_domains for backwards compatibility
  let frameSrc = "'self' blob:";
  const frameDomains = widgetCSP?.frame_domains || widgetCSP?.resource_domains;
  if (frameDomains && frameDomains.length > 0) {
    frameSrc = `'self' blob: ${frameDomains.join(" ")}`;
  }

  const headers: Record<string, string> = {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${resourceDomainsStr}`,
      "worker-src 'self' blob:",
      `child-src 'self' blob: ${frameDomains?.join(" ") || ""}`.trim(),
      `frame-src ${frameSrc}`,
      `style-src 'self' 'unsafe-inline' ${resourceDomainsStr}`,
      `img-src ${imgSrc}`,
      `media-src ${mediaSrc}`,
      `font-src ${fontSrc}`,
      `connect-src ${connectSrc}`,
      "frame-ancestors 'self'",
    ].join("; "),
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };

  // In dev mode, add a Report-Only CSP header with production rules
  // This will warn about resources that would fail in production
  if (devServerOrigin) {
    const prodConnectSrc = "'self' https: wss: ws:";
    // Build production frame-src (use frame_domains if specified, fall back to resource_domains)
    let prodFrameSrc = "'self' blob:";
    const prodFrameDomains =
      widgetCSP?.frame_domains || widgetCSP?.resource_domains;
    if (prodFrameDomains && prodFrameDomains.length > 0) {
      prodFrameSrc = `'self' blob: ${prodFrameDomains.join(" ")}`;
    }
    headers["Content-Security-Policy-Report-Only"] = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${prodResourceDomainsStr}`,
      "worker-src 'self' blob:",
      `child-src 'self' blob: ${prodFrameDomains?.join(" ") || ""}`.trim(),
      `frame-src ${prodFrameSrc}`,
      `style-src 'self' 'unsafe-inline' ${prodResourceDomainsStr}`,
      "img-src 'self' data: https: blob:",
      "media-src 'self' data: https: blob:",
      `font-src 'self' data: ${prodResourceDomainsStr}`,
      `connect-src ${prodConnectSrc}`,
      "frame-ancestors 'self'",
    ].join("; ");
  }

  return headers;
}
