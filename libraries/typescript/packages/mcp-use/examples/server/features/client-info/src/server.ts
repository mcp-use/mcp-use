/**
 * Client Info & Capability Access Example
 *
 * Demonstrates ctx.client — the per-connection and per-invocation context
 * available in every tool callback.
 *
 * ─── Session-level (stable for the lifetime of the MCP connection) ───────────
 *   ctx.client.info()          — { name?, version? } from the initialize handshake
 *   ctx.client.capabilities()  — full capabilities object advertised by the client
 *   ctx.client.can(cap)        — check a top-level capability (sampling, elicitation, …)
 *   ctx.client.extension(id)   — raw settings for an MCP extension (SEP-1724)
 *   ctx.client.supportsApps()  — convenience check for MCP Apps (SEP-1865)
 *
 * ─── Per-invocation (can differ on every tools/call) ─────────────────────────
 *   ctx.client.user()          — normalized caller context from params._meta
 *     .subject                 — stable opaque user identifier
 *     .conversationId          — current chat thread ID (≠ MCP session ID)
 *     .locale                  — BCP-47 locale, e.g. "it-IT"
 *     .location                — { city, region, country, timezone, … }
 *     .userAgent               — browser / host user-agent string
 *     .timezoneOffsetMinutes   — UTC offset in minutes
 *
 * ctx.client.user() returns undefined for clients that do not include
 * request-level metadata (Inspector, Claude Desktop, CLI, etc.).
 *
 * ─── ChatGPT multi-tenant model ──────────────────────────────────────────────
 * ChatGPT uses a SINGLE MCP session for all users of a deployed app.
 * Use ctx.client.user() to distinguish callers within that shared session:
 *
 *   1 MCP session  ctx.session.sessionId            — shared across ALL users
 *     N subjects   ctx.client.user()?.subject       — one per ChatGPT user account
 *       M threads  ctx.client.user()?.conversationId — one per chat conversation
 *
 * ─── vs ctx.auth ─────────────────────────────────────────────────────────────
 * ctx.client.user() is client-reported and UNVERIFIED — treat it as advisory.
 * ctx.auth (requires OAuth) provides server-verified identity (email, scopes).
 */

import { MCPServer, object, text, widget } from "mcp-use/server";
import z from "zod";

const server = new MCPServer({
  name: "client-info-example-server",
  version: "1.0.0",
  description:
    "Demonstrates ctx.client — access client identity, capabilities, and per-invocation caller context from any tool callback.",
});

// ---------------------------------------------------------------------------
// Tool 1: who-is-connected
// Human-readable summary of the connecting client and current caller.
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "who-is-connected",
    description:
      "Returns a formatted summary of the MCP client and end-user context for the current tool call.",
    schema: z.object({}),
  },
  async (_params, ctx) => {
    const { name, version } = ctx.client.info();
    const caps = ctx.client.capabilities();
    const capKeys = Object.keys(caps);

    const lines = [
      "=== MCP Client (session-level) ===",
      `Client: ${[name, version].filter(Boolean).join(" ") || "unknown"}`,
      `Capabilities: ${capKeys.length ? capKeys.join(", ") : "none advertised"}`,
      `MCP Apps support (SEP-1865): ${ctx.client.supportsApps() ? "yes ✓" : "no"}`,
      `MCP Session ID: ${ctx.session.sessionId}`,
    ];

    const caller = ctx.client.user();
    if (caller) {
      lines.push("");
      lines.push("=== Caller Context (per-invocation) ===");
      if (caller.subject) lines.push(`User ID: ${caller.subject}`);
      if (caller.conversationId)
        lines.push(`Conversation ID: ${caller.conversationId}`);
      if (caller.locale) lines.push(`Locale: ${caller.locale}`);
      if (caller.location) {
        const loc = caller.location;
        const parts = [loc.city, loc.region, loc.country].filter(Boolean);
        if (parts.length) lines.push(`Location: ${parts.join(", ")}`);
        if (loc.timezone) lines.push(`Timezone: ${loc.timezone}`);
      }
      if (caller.timezoneOffsetMinutes !== undefined) {
        lines.push(`UTC offset: ${caller.timezoneOffsetMinutes} min`);
      }
      lines.push("");
      lines.push(
        "Note: MCP Session ID is shared across all ChatGPT users of this app."
      );
      lines.push(
        "      Use subject + conversationId to distinguish individual callers."
      );
    } else {
      lines.push("");
      lines.push(
        "Caller context: not available (client does not send per-invocation metadata)."
      );
    }

    const response = lines.join("\n");
    console.log("[who-is-connected]\n" + response);
    return text(response);
  }
);

// ---------------------------------------------------------------------------
// Tool 2: get-capabilities
// Full capabilities as structured JSON — useful for inspection or debugging.
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "get-capabilities",
    description:
      "Returns the full capabilities object advertised by the connected client, including MCP extensions such as io.modelcontextprotocol/ui (SEP-1865).",
    schema: z.object({}),
  },
  async (_params, ctx) => {
    const info = ctx.client.info();
    const caps = ctx.client.capabilities();

    const response = {
      // Session-level fields — stable for the lifetime of the MCP connection
      clientInfo: {
        name: info.name ?? null,
        version: info.version ?? null,
      },
      capabilities: caps,
      supportsApps: ctx.client.supportsApps(),
      mcpAppsExtension:
        ctx.client.extension("io.modelcontextprotocol/ui") ?? null,
      mcpSessionId: ctx.session.sessionId,
      // Per-invocation field — may differ on every tool call
      callerContext: ctx.client.user() ?? null,
    };

    console.log("[get-capabilities]", JSON.stringify(response, null, 2));
    return object(response);
  }
);

// ---------------------------------------------------------------------------
// Tool 3: get-caller-context
// Demonstrates the ChatGPT multi-tenant model: one MCP session, many callers.
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "get-caller-context",
    description:
      "Returns per-invocation caller context from ctx.client.user(). Illustrates the ChatGPT multi-tenant model where one MCP session is shared across many users and conversations.",
    schema: z.object({}),
  },
  async (_params, ctx) => {
    const caller = ctx.client.user();

    const response = {
      // The MCP session ID is shared across ALL ChatGPT users of this app.
      // It is NOT a reliable way to identify individual users.
      mcpSessionId: ctx.session.sessionId,

      // Per-invocation caller context — these change with every user / chat.
      callerAvailable: caller !== undefined,
      subject: caller?.subject ?? null, // stable user ID (same across chats)
      conversationId: caller?.conversationId ?? null, // this chat thread only
      locale: caller?.locale ?? null,
      location: caller?.location ?? null,
      userAgent: caller?.userAgent ?? null,
      timezoneOffsetMinutes: caller?.timezoneOffsetMinutes ?? null,

      note: caller
        ? "subject stays constant across conversations for the same user. " +
          "conversationId changes for each new chat. " +
          "mcpSessionId is shared across ALL users."
        : "This client does not send per-invocation metadata. " +
          "ctx.client.user() is only populated by clients like ChatGPT.",
    };

    console.log("[get-caller-context]", JSON.stringify(response, null, 2));
    return object(response);
  }
);

// ---------------------------------------------------------------------------
// Tool 4: adaptive-greeting
// Primary use-case: return a widget for MCP Apps clients, plain text otherwise.
// Personalises with locale and location from ctx.client.user() when available.
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "adaptive-greeting",
    description:
      "Greets the user. Returns a rich widget for MCP Apps-capable clients (ChatGPT, Goose, …) and plain text for all other clients. Personalises using caller context when available.",
    schema: z.object({
      name: z.string().describe("The name to greet"),
    }),
  },
  async ({ name }, ctx) => {
    const { name: clientName, version: clientVersion } = ctx.client.info();
    const clientLabel =
      [clientName, clientVersion].filter(Boolean).join(" ") || "unknown client";

    const caller = ctx.client.user();
    const locale = caller?.locale;
    const city = caller?.location?.city;
    const locationHint = city ? ` from ${city}` : "";

    if (ctx.client.supportsApps()) {
      const summary = `Hello, ${name}${locationHint}! (rendered as MCP Apps widget via ${clientLabel})`;
      console.log(`[adaptive-greeting] MCP Apps path → widget | ${summary}`);
      return widget({
        props: {
          greeting: `Hello, ${name}!`,
          clientName: clientLabel,
          protocol: "mcp-apps",
          locale: locale ?? null,
          location: caller?.location ?? null,
        },
        output: text(summary),
      });
    }

    const summary = `Hello, ${name}${locationHint}! You are connected via ${clientLabel}, which does not advertise MCP Apps support.`;
    console.log(`[adaptive-greeting] plain-text path → "${summary}"`);
    return text(summary);
  }
);

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

await server.listen();
