import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/ext-apps/app-bridge";

const OPENAI_COMPATIBILITY_BRIDGE_SCRIPT = `<script>
(function () {
  var files = new Map();
  var pendingRequests = new Map();
  var requestId = 0;
  var hostConnected = false;
  var fallbackTimer;
  var api = window.openai || {};

  function dispatchGlobals(globals) {
    Object.assign(api, globals);
    window.dispatchEvent(new CustomEvent("openai:set_globals", {
      detail: { globals: globals }
    }));
  }

  function applyHostContext(context) {
    if (!context || typeof context !== "object") return;
    var globals = {};
    if (context.theme !== undefined) globals.theme = context.theme;
    if (context.displayMode !== undefined) globals.displayMode = context.displayMode;
    if (context.locale !== undefined) globals.locale = context.locale;
    if (context.view !== undefined) globals.view = context.view;
    if (context.safeAreaInsets !== undefined) {
      globals.safeArea = { insets: context.safeAreaInsets };
    }
    if (context.containerDimensions && context.containerDimensions.maxHeight !== undefined) {
      globals.maxHeight = context.containerDimensions.maxHeight;
    }
    if (context.platform !== undefined || context.deviceCapabilities !== undefined) {
      globals.userAgent = {
        device: {
          type: context.platform === "mobile" ? "mobile" : "desktop"
        },
        capabilities: {
          hover: !!(context.deviceCapabilities && context.deviceCapabilities.hover),
          touch: !!(context.deviceCapabilities && context.deviceCapabilities.touch)
        }
      };
    }
    dispatchGlobals(globals);
  }

  function markHostConnected(result) {
    hostConnected = true;
    clearTimeout(fallbackTimer);
    if (result && result.hostContext) applyHostContext(result.hostContext);
  }

  function postMessage(message) {
    if (window.parent === window) {
      throw new Error("window.openai compatibility APIs require an iframe host");
    }
    window.parent.postMessage(message, "*");
  }

  function sendRequest(method, params) {
    var id = "mcp-use-openai-compat-" + (++requestId);
    return new Promise(function (resolve, reject) {
      pendingRequests.set(id, { resolve: resolve, reject: reject });
      postMessage({ jsonrpc: "2.0", id: id, method: method, params: params });
      window.setTimeout(function () {
        var pending = pendingRequests.get(id);
        if (!pending) return;
        pendingRequests.delete(id);
        pending.reject(new Error("Request timeout: " + method));
      }, 30000);
    });
  }

  function sendNotification(method, params) {
    postMessage({ jsonrpc: "2.0", method: method, params: params });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      var pending = pendingRequests.get(message.id);
      if (pending) {
        pendingRequests.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || "Host request failed"));
        else pending.resolve(message.result);
        return;
      }
      if (message.result && (message.result.hostInfo || message.result.hostContext)) {
        markHostConnected(message.result);
      }
      return;
    }

    if (message.id !== undefined || typeof message.method !== "string") return;
    var params = message.params || {};
    switch (message.method) {
      case "ui/notifications/tool-input":
        markHostConnected();
        dispatchGlobals({ toolInput: params.arguments || {} });
        break;
      case "ui/notifications/tool-input-partial":
        // window.openai has no partial-input global. Do not expose incomplete
        // or approval-gated arguments as if the final tool input had arrived.
        markHostConnected();
        break;
      case "ui/notifications/tool-result":
        markHostConnected();
        dispatchGlobals({
          // OpenAI defines toolOutput as structuredContent, not the complete
          // CallToolResult envelope. Keep that envelope (including hidden
          // _meta) in toolResponseMetadata instead.
          toolOutput: params.structuredContent === undefined ? null : params.structuredContent,
          toolResponseMetadata: params
        });
        break;
      case "ui/notifications/host-context-changed":
        markHostConnected();
        applyHostContext(params);
        break;
    }
  });

  api.toolInput = api.toolInput === undefined ? null : api.toolInput;
  api.toolOutput = api.toolOutput === undefined ? null : api.toolOutput;
  api.toolResponseMetadata =
    api.toolResponseMetadata === undefined ? null : api.toolResponseMetadata;
  api.widgetState = api.widgetState === undefined ? null : api.widgetState;
  api.theme = api.theme || "light";
  api.displayMode = api.displayMode || "inline";
  api.safeArea = api.safeArea || {
    insets: { top: 0, right: 0, bottom: 0, left: 0 }
  };
  api.maxHeight = api.maxHeight || 600;
  api.userAgent = api.userAgent || {
    device: { type: "desktop" },
    capabilities: { hover: true, touch: false }
  };
  api.locale = api.locale || "en";

  api.callTool = api.callTool || function (name, args) {
    return sendRequest("tools/call", { name: name, arguments: args || {} });
  };
  api.sendFollowUpMessage = api.sendFollowUpMessage || function (request) {
    return sendRequest("ui/message", {
      role: "user",
      content: [{ type: "text", text: request.prompt }]
    });
  };
  api.openExternal = api.openExternal || function (request) {
    return sendRequest("ui/open-link", { url: request.href });
  };
  api.requestDisplayMode = api.requestDisplayMode || function (request) {
    return sendRequest("ui/request-display-mode", { mode: request.mode });
  };
  api.setWidgetState = api.setWidgetState || function (state) {
    dispatchGlobals({ widgetState: state });
    // The Apps SDK setter is promise-based. Keep the local state update
    // synchronous, but return a promise so legacy useWidget() code can safely
    // await or chain .catch() on the compatibility API.
    return Promise.resolve();
  };
  api.notifyIntrinsicHeight = api.notifyIntrinsicHeight || function (height) {
    sendNotification("ui/notifications/size-changed", { height: height });
    return Promise.resolve();
  };
  api.uploadFile = api.uploadFile || async function (file) {
    var fileId = crypto.randomUUID();
    files.set(fileId, file);
    return { fileId: fileId };
  };
  api.getFileDownloadUrl = api.getFileDownloadUrl || async function (ref) {
    var file = files.get(ref.fileId);
    if (!file) {
      throw new Error("File not found: " + ref.fileId);
    }
    return { downloadUrl: URL.createObjectURL(file) };
  };
  window.openai = api;

  // Native V2 views initialize their own MCP Apps bridge. Only initialize this
  // compatibility bridge when no other guest handshake appears, so the file
  // helpers remain safe for both V2 views and legacy useWidget() bundles.
  fallbackTimer = window.setTimeout(function () {
    if (hostConnected) return;
    sendRequest("ui/initialize", {
      appCapabilities: {},
      appInfo: { name: "mcp-use-openai-compat", version: "1.0.0" },
      protocolVersion: ${JSON.stringify(LATEST_PROTOCOL_VERSION)}
    }).then(function (result) {
      markHostConnected(result);
      sendNotification("ui/notifications/initialized", {});
    }).catch(function (error) {
      console.warn("[window.openai compatibility] Failed to initialize:", error);
    });
  }, 1000);
})();
</script>`;

/**
 * Prepend the shared ChatGPT Apps SDK compatibility aliases and
 * Inspector-supported file helpers. Native V2 views keep using MCP Apps;
 * legacy useWidget() bundles receive the same tool lifecycle and host actions
 * through window.openai. Unsupported ChatGPT-only extensions remain absent so
 * apps can feature-detect them as documented.
 */
export function injectOpenAiFileApis(html: string): string {
  const headEnd = findOpeningConstructEnd(html, "<head");
  if (headEnd !== undefined) {
    return insertAt(html, headEnd, OPENAI_COMPATIBILITY_BRIDGE_SCRIPT);
  }
  const htmlEnd = findOpeningConstructEnd(html, "<html");
  if (htmlEnd !== undefined) {
    return insertAt(
      html,
      htmlEnd,
      "<head>" + OPENAI_COMPATIBILITY_BRIDGE_SCRIPT + "</head>"
    );
  }
  const doctypeEnd = findOpeningConstructEnd(html, "<!doctype");
  if (doctypeEnd !== undefined) {
    return insertAt(
      html,
      doctypeEnd,
      "<head>" + OPENAI_COMPATIBILITY_BRIDGE_SCRIPT + "</head>"
    );
  }
  return OPENAI_COMPATIBILITY_BRIDGE_SCRIPT + html;
}

function findOpeningConstructEnd(
  html: string,
  lowercasePrefix: string
): number | undefined {
  const lowercaseHtml = html.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < lowercaseHtml.length) {
    const start = lowercaseHtml.indexOf(lowercasePrefix, searchFrom);
    if (start === -1) return undefined;
    const boundary = lowercaseHtml[start + lowercasePrefix.length];
    if (
      boundary === ">" ||
      boundary === " " ||
      boundary === "\t" ||
      boundary === "\n" ||
      boundary === "\r" ||
      boundary === "\f"
    ) {
      let quote: '"' | "'" | undefined;
      for (
        let index = start + lowercasePrefix.length;
        index < html.length;
        index++
      ) {
        const character = html[index];
        if (quote) {
          if (character === quote) quote = undefined;
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }
        if (character === ">") return index + 1;
      }
      return undefined;
    }
    searchFrom = start + lowercasePrefix.length;
  }
  return undefined;
}

function insertAt(value: string, index: number, addition: string): string {
  return value.slice(0, index) + addition + value.slice(index);
}
