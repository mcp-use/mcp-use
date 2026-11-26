/** Lightweight, side-effect-free help text for the `mcp-use client` tree. */

interface HelpPage {
  usage: string;
  summary: string;
  commands?: readonly [syntax: string, description: string][];
  options?: readonly [syntax: string, description: string][];
  notes?: readonly string[];
}

/**
 * Result of resolving a client help request.
 *
 * @internal
 */
interface ClientHelpResult {
  /** Rendered help, or `undefined` when the command path is not public. */
  text?: string;
  /** Invalid command path, suitable for a concise usage error. */
  error?: string;
}

const HELP: [string, string] = ["-h, --help", "Show this help"];
const JSON: [string, string] = [
  "--json",
  "Emit machine-readable JSON (accepted anywhere after client)",
];
const pages = new Map<string, HelpPage>();

function page(path: string, value: HelpPage): void {
  pages.set(path, value);
}

page("", {
  usage: "mcp-use client <command>",
  summary: "Connect to and invoke saved HTTP(S) MCP servers.",
  commands: [
    ["connect <name> <url>", "Connect and save a server"],
    ["list", "List saved servers"],
    ["remove <name>", "Remove a saved server"],
    ["<name>", "Invoke a saved server"],
  ],
  options: [HELP],
});

page("connect", {
  usage: "mcp-use client connect <name> <url> [options]",
  summary: "Connect to and save an HTTP(S) MCP server.",
  options: [
    ['-H, --header <"Key: Value">', "Static header (repeatable)"],
    ["--no-oauth", "Skip OAuth on authorization challenges"],
    ["--auth-timeout <ms>", "OAuth wait timeout (default: 300000)"],
    [
      "--protocol <auto|legacy|modern>",
      "Protocol mode (default: auto; modern is stateless/sessionless)",
    ],
    ["--no-open", "Print the OAuth URL without opening a browser"],
    JSON,
    HELP,
  ],
  notes: [
    "JSON mode never opens a browser or prints an OAuth URL/state. If new consent is required, it returns oauth_interaction_required with an interactive retry command.",
  ],
});

page("list", {
  usage: "mcp-use client list [options]",
  summary: "List saved MCP servers.",
  options: [JSON, HELP],
});

page("remove", {
  usage: "mcp-use client remove <name> [options]",
  summary: "Immediately remove a saved server and its credentials.",
  options: [JSON, HELP],
});

page("<name>", {
  usage: "mcp-use client <name> <command>",
  summary: "Invoke a saved MCP server.",
  commands: [
    ["tools", "List, describe, or call tools"],
    ["resources", "List or read resources"],
    ["prompts", "List or get prompts"],
    ["events", "List, poll, or subscribe to MCP Events"],
    ["auth", "Authenticate or inspect saved OAuth state"],
  ],
  options: [HELP],
});

page("<name> tools", {
  usage: "mcp-use client <name> tools <command>",
  summary: "Use tools on a saved MCP server.",
  commands: [
    ["list", "List tools"],
    ["describe <tool>", "Show a tool definition"],
    ["call <tool> [args...]", "Call a tool"],
  ],
  options: [HELP],
});

page("<name> tools list", {
  usage: "mcp-use client <name> tools list [options]",
  summary: "List tools on a saved MCP server.",
  options: [JSON, HELP],
});

page("<name> tools describe", {
  usage: "mcp-use client <name> tools describe <tool> [options]",
  summary: "Show one tool definition.",
  options: [JSON, HELP],
});

page("<name> tools call", {
  usage: "mcp-use client <name> tools call <tool> [args...] [options]",
  summary: "Call a tool on a saved MCP server.",
  options: [["--timeout <ms>", "Call timeout (default: 30000)"], JSON, HELP],
  notes: [
    "Arguments are one JSON object or key=value/key:=<json> pairs; do not mix forms.",
  ],
});

page("<name> resources", {
  usage: "mcp-use client <name> resources <command>",
  summary: "Use resources on a saved MCP server.",
  commands: [
    ["list", "List resources"],
    ["read <uri>", "Read a resource"],
  ],
  options: [HELP],
});

page("<name> resources list", {
  usage: "mcp-use client <name> resources list [options]",
  summary: "List resources on a saved MCP server.",
  options: [JSON, HELP],
});

page("<name> resources read", {
  usage: "mcp-use client <name> resources read <uri> [options]",
  summary: "Read one resource.",
  options: [JSON, HELP],
});

page("<name> prompts", {
  usage: "mcp-use client <name> prompts <command>",
  summary: "Use prompts on a saved MCP server.",
  commands: [
    ["list", "List prompts"],
    ["get <prompt> [args...]", "Get a prompt"],
  ],
  options: [HELP],
});

page("<name> prompts list", {
  usage: "mcp-use client <name> prompts list [options]",
  summary: "List prompts on a saved MCP server.",
  options: [JSON, HELP],
});

page("<name> prompts get", {
  usage: "mcp-use client <name> prompts get <prompt> [args...] [options]",
  summary: "Get a prompt from a saved MCP server.",
  options: [JSON, HELP],
  notes: [
    "Arguments are one JSON object or key=value/key:=<json> pairs; do not mix forms.",
  ],
});

page("<name> events", {
  usage: "mcp-use client <name> events <command>",
  summary: "Use MCP Events on a saved MCP server.",
  commands: [
    ["list", "List events"],
    ["poll <event> [args...]", "Poll an event (official extension)"],
    ["subscribe <event> [args...]", "Subscribe a webhook URL"],
    ["unsubscribe <event> [args...]", "Remove a webhook subscription"],
  ],
  options: [HELP],
});

page("<name> events list", {
  usage: "mcp-use client <name> events list [options]",
  summary: "List the events a server publishes.",
  options: [JSON, HELP],
});

page("<name> events poll", {
  usage: "mcp-use client <name> events poll <event> [args...] [options]",
  summary: "Poll an event once, or keep polling with --follow.",
  options: [
    ["--cursor <cursor>", "Resume from a cursor (default: start from now)"],
    ["--follow", "Keep polling and print events until interrupted"],
    ["--max-events <n>", "Cap events per poll"],
    JSON,
    HELP,
  ],
  notes: [
    "Arguments are one JSON object or key=value/key:=<json> pairs; do not mix forms.",
  ],
});

page("<name> events subscribe", {
  usage:
    "mcp-use client <name> events subscribe <event> --url <url> [args...] [options]",
  summary: "Subscribe a webhook URL to an event (also refreshes it).",
  options: [
    ["--url <url>", "HTTPS callback URL"],
    ["--secret <whsec>", "Signing secret (default: generated and printed)"],
    ["--ttl <ms>", "Requested lifetime in milliseconds"],
    JSON,
    HELP,
  ],
});

page("<name> events unsubscribe", {
  usage:
    "mcp-use client <name> events unsubscribe <event> --url <url> [args...] [options]",
  summary: "Remove a webhook subscription.",
  options: [["--url <url>", "Callback URL used to subscribe"], JSON, HELP],
});

page("<name> auth", {
  usage: "mcp-use client <name> auth <command>",
  summary: "Manage saved OAuth state.",
  commands: [
    ["login", "Authenticate this server"],
    ["status", "Show OAuth status"],
    ["logout", "Delete saved OAuth credentials"],
  ],
  options: [HELP],
});

page("<name> auth login", {
  usage: "mcp-use client <name> auth login [options]",
  summary: "Authenticate a saved MCP server with OAuth.",
  options: [JSON, HELP],
});

page("<name> auth status", {
  usage: "mcp-use client <name> auth status [options]",
  summary: "Show saved OAuth status.",
  options: [JSON, HELP],
});

page("<name> auth logout", {
  usage: "mcp-use client <name> auth logout [options]",
  summary: "Delete saved OAuth credentials but keep the server.",
  options: [["--yes", "Skip the confirmation prompt"], JSON, HELP],
});

/**
 * Resolve and render a `client` argv vector containing `--help` or `-h`.
 *
 * The resolver uses command positions only, so help never reads saved
 * connections, loads the Client SDK, opens a browser, or performs MCP work.
 *
 * @param argv - Arguments following `mcp-use client`.
 * @returns Scoped help or a concise invalid-path error.
 *
 * @internal
 */
export function resolveClientHelp(argv: readonly string[]): ClientHelpResult {
  const path = argv.filter(
    (token) => token !== "--help" && token !== "-h" && token !== "--json"
  );
  const first = path[0];
  if (first === undefined) return { text: render(pages.get("")!) };

  if (first === "connect" || first === "list" || first === "remove") {
    return { text: render(pages.get(first)!) };
  }

  const family = path[1];
  if (family === undefined) return { text: render(pages.get("<name>")!) };
  if (!["tools", "resources", "prompts", "events", "auth"].includes(family)) {
    return { error: `Unknown client command family: ${family}` };
  }

  const operation = path[2];
  const familyKey = `<name> ${family}`;
  if (operation === undefined) return { text: render(pages.get(familyKey)!) };

  const key = `${familyKey} ${operation}`;
  const selected = pages.get(key);
  if (selected === undefined) {
    return { error: `Unknown client ${family} command: ${operation}` };
  }
  return { text: render(selected) };
}

function render(value: HelpPage): string {
  const sections = [`Usage: ${value.usage}`, value.summary];
  if (value.commands !== undefined) {
    sections.push(renderRows("Commands", value.commands));
  }
  if (value.options !== undefined) {
    sections.push(renderRows("Options", value.options));
  }
  if (value.notes !== undefined) sections.push(value.notes.join("\n"));
  return sections.join("\n\n");
}

function renderRows(
  heading: string,
  rows: readonly [syntax: string, description: string][]
): string {
  const width = Math.max(...rows.map(([syntax]) => syntax.length));
  return `${heading}:\n${rows
    .map(([syntax, description]) => `  ${syntax.padEnd(width)}  ${description}`)
    .join("\n")}`;
}
