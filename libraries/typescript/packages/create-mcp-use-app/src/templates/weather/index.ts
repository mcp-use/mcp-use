import { createMCPServer } from 'mcp-use/server'

const server = createMCPServer('test-app', {
  version: '1.0.0',
  description: 'Test MCP server',
  host: process.env.HOST || 'localhost',
  baseUrl: process.env.MCP_URL, // Full base URL (e.g., https://myserver.com)
})



server.tool({
  name: 'get-my-city',
  description: 'Get my city',
  cb: async () => {
    return { content: [{ type: 'text', text: `My city is San Francisco` }] }
  },
})
server.uiResource({

  title: 'Show Pizza Map',
  description: 'Interactive map widget for displaying pizza locations',
  type: 'appsSdk',
  name: 'pizza-map-3',
  htmlTemplate: `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />
  <title>Pizza Map 3 — Refresh & Inputs</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; }
    .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    button { padding: 8px 12px; border: 1px solid #ccc; border-radius: 8px; cursor: pointer; }
    pre { background: #f6f6f6; padding: 12px; border-radius: 8px; overflow: auto; }
    .pill { font-size: 12px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 999px; }
    label { display: block; font-size: 12px; margin-top: 10px; opacity: 0.8; }
    input, textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  </style>
</head>
<body>
  <h2>Pizza Map 3 — Refresh & Inspect Inputs</h2>

  <div class="row" style="margin-bottom:12px;">
    <button id="refreshBtn">Refresh pizza-map-3</button>
    <span class="pill" id="modePill">mode: inline</span>uco
    <span class="pill" id="themePill">theme: light</span>
  </div>

  <div class="grid">
    <div>
      <label>Current toolInput (detected)</label>
      <pre id="toolInputView">{}</pre>
    </div>
    <div>
      <label>Current toolOutput (last run)</label>
      <pre id="toolOutputView">null</pre>
    </div>
  </div>

  <label style="margin-top:16px;">Override args for next refresh (JSON object)</label>
  <textarea id="argsTextarea" rows="6" placeholder='{"city":"Zurich","bounds":{"north":47.42,"south":47.32,"east":8.64,"west":8.47}}'></textarea>

  <script>
    // Helpers to read host-provided globals in real time
    const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";

    function renderGlobals() {
      try {
        const ti = window.openai?.toolInput ?? {};
        const to = window.openai?.toolOutput ?? null;
        const mode = window.openai?.displayMode ?? "inline";
        const theme = window.openai?.theme ?? "light";

        document.getElementById("toolInputView").textContent = JSON.stringify(ti, null, 2);
        document.getElementById("toolOutputView").textContent =
          to == null ? "null" : JSON.stringify(to, null, 2);

        document.getElementById("modePill").textContent = \`mode: \${mode}\`;
        document.getElementById("themePill").textContent = \`theme: \${theme}\`;

        // Pre-fill the override box the first time
        const ta = document.getElementById("argsTextarea");
        if (!ta.dataset.hydrated) {
          ta.value = JSON.stringify(ti || {}, null, 2);
          ta.dataset.hydrated = "true";
        }
      } catch (e) {
        console.warn("renderGlobals error", e);
      }
    }

    window.addEventListener(SET_GLOBALS_EVENT_TYPE, (evt) => {
      // Re-render when any global changes
      renderGlobals();
    }, { passive: true });

    // Initial paint
    renderGlobals();

    // Wire the Refresh button
    document.getElementById("refreshBtn").addEventListener("click", async () => {
      const textarea = document.getElementById("argsTextarea");
      let args = {};
      try {
        const text = textarea.value.trim();
        args = text ? JSON.parse(text) : {};
      } catch (e) {
        alert("Args must be a valid JSON object");
        return;
      }

      // Call the tool from the component
      try {
        const res = await window.openai?.callTool("pizza-map-3", args);
        // The host will update toolOutput; we also show the raw response here
        console.log("pizza-map-3 result", res);
      } catch (err) {
        console.error("callTool failed", err);
        alert("Tool call failed. See console for details.");
      }
    });
  </script>
</body>
</html>
  

  `.trim(),
  size: ['800px', '600px'],
  props: {
    pizzaTopping: {
      type: 'string',
      description: 'Topping to mention when rendering the widget',
      required: true
    }
  },
  appsSdkMetadata: {
    'openai/widgetDescription': 'Interactive map widget for displaying pizza locations',
    'openai/toolInvocation/invoking': 'Hand-tossing a map',
    'openai/toolInvocation/invoked': 'Served a fresh map',
    'openai/widgetAccessible': true,
    'openai/resultCanProduceWidget': true,
    'openai/widgetCSP': {
      connect_domains: ['https://chatgpt.com'],
      resource_domains: [
          'https://*.oaistatic.com',
          'https://*.unsplash.com',
          'https://*.oaiusercontent.com',
          'https://*.mapbox.com',
      ],
    }
  }
})


const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000
const HOST = process.env.HOST || 'localhost'
server.listen(PORT)
console.log(`Server running at http://${HOST}:${PORT}`)