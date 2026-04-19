import { MCPServer } from "mcp-use/server";

/**
 * ════════════════════════════════════════════════════════════════════
 *  MCP Apps — Programmatic Widget Gallery
 * ════════════════════════════════════════════════════════════════════
 *
 * This example demonstrates `server.uiResource({ type: "mcpApps", ... })` —
 * the *programmatic* path for MCP Apps widgets. You define the widget HTML
 * inline with `htmlTemplate`, declare typed props, and the server handles
 * tool + resource registration automatically.
 *
 * When to use this pattern
 *   • Lightweight widgets (a card, a form, a chart) that don't need React
 *   • Build-free deployments — everything is HTML+JS strings in your server
 *   • Widgets that should just work out of the box in ChatGPT, Claude, etc.
 *
 * When to prefer `resources/*.tsx` (React auto-discovery) instead
 *   • Complex interactive UIs
 *   • Shared components, hot-reload during dev, tailwind, etc.
 *   • See ../mcp-apps/ for that pattern.
 *
 * Widgets registered below:
 *   1. welcome-card  — static info card (no props)
 *   2. quick-poll    — interactive poll with client-side vote tracking
 *   3. task-card     — data-driven card with typed props
 *
 * Every widget here works with both ChatGPT (Apps SDK) and MCP Apps
 * clients (Claude, Goose, ...) thanks to dual-protocol support.
 */

const server = new MCPServer({
  name: "mcp-apps-gallery",
  version: "1.0.0",
  description:
    "MCP Apps widget gallery — three programmatic widgets built with server.uiResource({ type: 'mcpApps' })",
});

// ────────────────────────────────────────────────────────────────────
// 1. welcome-card — static info card
// ────────────────────────────────────────────────────────────────────

server.uiResource({
  type: "mcpApps",
  name: "welcome-card",
  title: "Welcome",
  description: "A welcome card with server information",
  htmlTemplate: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          margin: 0;
          padding: 24px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        .card {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 32px;
          border: 1px solid rgba(255, 255, 255, 0.18);
        }
        h1 { margin: 0 0 12px 0; font-size: 2em; }
        p  { margin: 12px 0; opacity: 0.9; }
        .stats { display: flex; gap: 16px; margin-top: 20px; }
        .stat  { background: rgba(255,255,255,0.1); padding: 14px; border-radius: 8px; flex: 1; }
        .stat-value { font-size: 1.6em; font-weight: 700; }
        .stat-label { font-size: 0.85em; opacity: 0.8; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🎉 Welcome to MCP Apps</h1>
        <p>Your server is running and serving interactive widgets to any MCP-compatible client.</p>
        <div class="stats">
          <div class="stat"><div class="stat-value">3</div><div class="stat-label">Widget patterns</div></div>
          <div class="stat"><div class="stat-value">∞</div><div class="stat-label">Clients supported</div></div>
          <div class="stat"><div class="stat-value">⚡</div><div class="stat-label">No build step</div></div>
        </div>
      </div>
    </body>
    </html>
  `,
  metadata: {
    prefersBorder: true,
    widgetDescription: "Server welcome card",
  },
  exposeAsTool: true,
});

// ────────────────────────────────────────────────────────────────────
// 2. quick-poll — interactive poll (client-side vote tracking)
// ────────────────────────────────────────────────────────────────────

server.uiResource({
  type: "mcpApps",
  name: "quick-poll",
  title: "Quick Poll",
  description: "Create an instant poll with interactive voting",
  props: {
    question: {
      type: "string",
      required: true,
      description: "The poll question",
    },
    options: {
      type: "array",
      required: true,
      description: "List of answer options",
    },
  },
  htmlTemplate: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          margin: 0;
          padding: 24px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f7fafc;
        }
        .poll { max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        h2 { margin: 0 0 6px 0; font-size: 1.4em; }
        .sub { color: #718096; font-size: 0.9em; margin-bottom: 16px; }
        .question { font-size: 1.1em; font-weight: 600; margin: 12px 0 16px; }
        button { display: block; width: 100%; text-align: left; padding: 12px 16px; margin-bottom: 8px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-size: 1em; }
        button:hover { background: #edf2f7; }
        button.selected { background: #4299e1; color: white; border-color: #3182ce; }
        .tally { margin-top: 16px; font-size: 0.9em; color: #4a5568; }
      </style>
    </head>
    <body>
      <div class="poll">
        <h2>📊 Quick Poll</h2>
        <div class="sub">Click an option to vote</div>
        <div id="question" class="question"></div>
        <div id="options"></div>
        <div id="tally" class="tally"></div>
      </div>
      <script>
        const params = new URLSearchParams(window.location.search);
        const propsJson = params.get('props');
        const props = propsJson ? JSON.parse(propsJson) : { question: 'Sample?', options: ['A', 'B'] };
        const votes = Object.fromEntries(props.options.map(o => [o, 0]));

        document.getElementById('question').textContent = props.question;
        const optionsEl = document.getElementById('options');
        const tallyEl = document.getElementById('tally');

        props.options.forEach((opt) => {
          const btn = document.createElement('button');
          btn.textContent = opt;
          btn.addEventListener('click', () => {
            votes[opt]++;
            document.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            tallyEl.textContent = 'Current votes: ' + Object.entries(votes).map(([o, c]) => o + '=' + c).join(', ');
          });
          optionsEl.appendChild(btn);
        });
      </script>
    </body>
    </html>
  `,
  metadata: {
    prefersBorder: true,
    widgetDescription: "Interactive poll widget",
  },
  exposeAsTool: true,
});

// ────────────────────────────────────────────────────────────────────
// 3. task-card — data-driven card with typed props
// ────────────────────────────────────────────────────────────────────

server.uiResource({
  type: "mcpApps",
  name: "task-card",
  title: "Task Card",
  description: "Render a single task with title, status, and assignee",
  props: {
    title: { type: "string", required: true, description: "Task title" },
    description: { type: "string", required: false, description: "Task description" },
    status: {
      type: "string",
      required: true,
      description: "todo, in-progress, or done",
    },
    priority: {
      type: "string",
      required: false,
      description: "low, medium, or high",
    },
    assignee: { type: "string", required: false, description: "Assigned to" },
  },
  htmlTemplate: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; max-width: 420px; background: white; }
        .title { font-size: 1.1em; font-weight: 700; margin: 0 0 4px; }
        .desc { color: #4a5568; margin: 0 0 12px; font-size: 0.95em; }
        .row { display: flex; gap: 8px; flex-wrap: wrap; }
        .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 0.78em; font-weight: 600; }
        .badge.todo         { background: #edf2f7; color: #2d3748; }
        .badge.in-progress  { background: #bee3f8; color: #2b6cb0; }
        .badge.done         { background: #c6f6d5; color: #276749; }
        .badge.high         { background: #fed7d7; color: #9b2c2c; }
        .badge.medium       { background: #feebc8; color: #9c4221; }
        .badge.low          { background: #e2e8f0; color: #4a5568; }
        .assignee { color: #718096; font-size: 0.85em; margin-top: 8px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="title" id="title"></div>
        <div class="desc" id="desc" style="display:none"></div>
        <div class="row">
          <span class="badge" id="status"></span>
          <span class="badge" id="priority" style="display:none"></span>
        </div>
        <div class="assignee" id="assignee" style="display:none"></div>
      </div>
      <script>
        const params = new URLSearchParams(window.location.search);
        const propsJson = params.get('props');
        const props = propsJson ? JSON.parse(propsJson) : {};

        document.getElementById('title').textContent = props.title || 'Untitled';
        if (props.description) {
          const d = document.getElementById('desc');
          d.textContent = props.description;
          d.style.display = 'block';
        }
        const status = document.getElementById('status');
        status.textContent = props.status || 'todo';
        status.classList.add(props.status || 'todo');

        if (props.priority) {
          const p = document.getElementById('priority');
          p.textContent = props.priority;
          p.classList.add(props.priority);
          p.style.display = 'inline-block';
        }
        if (props.assignee) {
          const a = document.getElementById('assignee');
          a.textContent = 'Assigned to ' + props.assignee;
          a.style.display = 'block';
        }
      </script>
    </body>
    </html>
  `,
  metadata: {
    prefersBorder: true,
    widgetDescription: "Task card with status and priority badges",
  },
  exposeAsTool: true,
});

// ────────────────────────────────────────────────────────────────────
// Start server
// ────────────────────────────────────────────────────────────────────

await server.listen();

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🎨 MCP Apps Widget Gallery                          ║
╚═══════════════════════════════════════════════════════════════╝

Three programmatic MCP Apps widgets are running.

Endpoints
  MCP:        http://localhost:${server.serverPort}/mcp
  Inspector:  http://localhost:${server.serverPort}/inspector

Try them
  await client.callTool('welcome-card', {})
  await client.callTool('quick-poll', { question: 'React or Vue?', options: ['React', 'Vue'] })
  await client.callTool('task-card',   { title: 'Ship it', status: 'in-progress', priority: 'high', assignee: 'Alice' })

Prefer React widgets? See ../mcp-apps/ for the resources/*.tsx auto-discovery pattern.
`);
