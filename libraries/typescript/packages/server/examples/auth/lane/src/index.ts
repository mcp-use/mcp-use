/**
 * Lane's UCP index server, ported to mcp-use v2.
 *
 * The whole auth surface is `oauthLaneProvider`: it verifies Lane access
 * tokens, gates every tool below until the caller runs `lane_register_session`,
 * registers that tool plus `lane_session_info` and the `lane://auth-guide`
 * resource, serves the root-form protected-resource document, and appends the
 * step-up paragraphs to the `initialize` instructions. This file declares only
 * the UCP and checkout tools.
 */
import { MCPServer } from "mcp-use";
import {
  memoryLaneConnectionStore,
  oauthLaneProvider,
  type LaneEnforcement,
} from "mcp-use/oauth/lane";
import type { z } from "zod";

import { LANE_TOOLS, type LaneDeps } from "./lane-tools.js";
import { UCP_TOOLS } from "./ucp-tools.js";
import type { UcpDeps } from "./ucp.js";

const INSTRUCTIONS =
  "Lane's UCP index. Find who sells a thing, find one specific product across " +
  "every seller with a live price, browse one merchant's catalog, and get a " +
  "payment URL for a specific variant — a real hosted checkout with the item " +
  "already in it. Start with ucp_find_product when you know WHAT you want, or " +
  "ucp_find_merchants when you only know the kind of thing; pass the variant_id " +
  "either gives you to ucp_get_payment_url. To BUY it, hand that payment URL to " +
  "lane_checkout, which pays with a Lane card and returns an order_id — the UCP " +
  "tools themselves move no money. `lane_session_info` reports what Lane knows " +
  "about this session, which is how to confirm an auth integration worked.";

/**
 * Which connection scope each tool needs. Absence means "any connected
 * caller", never "anyone": the step-up is required for every tool either way.
 * The three catalog reads run under Lane's agent profile, not the caller's, so
 * no scope describes them. `ucp_get_payment_url` opens a checkout session a
 * person is expected to pay at, and `lane_checkout` spends money, so both ask
 * for `email`: a connection whose step-up identified a human. It must be a
 * scope Lane actually issues; an invented scope is silently dropped at
 * authorize time and the tool would never run while looking perfectly gated.
 */
const TOOL_SCOPES: Record<string, string> = {
  ucp_get_payment_url: "email",
  lane_checkout: "email",
  lane_checkout_status: "email",
};

const enforcement: LaneEnforcement =
  process.env["LANE_ENFORCEMENT"] === "log-only" ? "log-only" : "gate-all";

const server = new MCPServer({
  name: "lane-ucp-index",
  version: "0.2.0",
  description: INSTRUCTIONS,
  instructions: INSTRUCTIONS,
  publicLandingPage: true,
  oauth: oauthLaneProvider({
    connections: memoryLaneConnectionStore(),
    scopes: TOOL_SCOPES,
    enforcement,
    onGateEvent: (event) =>
      console.log(
        `[gate] ${event.decision} tool=${event.tool} agent=${event.agentId} scopes=[${event.scopes.join(" ")}]`
      ),
  }),
});

const ucpDeps: UcpDeps = {};
const laneDeps: LaneDeps = {};

const asText = (body: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
});

// The UCP surface: catalog reads and the checkout-session opener. Registered
// from one list so a tool cannot be declared in ucp-tools.ts and silently
// never reach the server.
for (const tool of UCP_TOOLS) {
  registerUcpTool(tool);
}

// The Lane surface: these forward the CALLER'S bearer to Lane's Order API,
// never a server-held credential. mcp-use exposes the verified bearer as
// `ctx.auth.accessToken`; the gate guarantees it is present here.
for (const tool of LANE_TOOLS) {
  registerLaneTool(tool);
}

// The tool modules export heterogeneous tuples whose `run` each narrows its own
// args. `args: never` is the parameter type every member's `run` is assignable
// to; the schema has already validated the arguments before `run` sees them.
interface UcpToolDef {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodObject<z.ZodRawShape>;
  readonly run: (args: never, deps: UcpDeps) => Promise<unknown>;
}

interface LaneToolDef {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodObject<z.ZodRawShape>;
  readonly run: (
    args: never,
    deps: LaneDeps,
    bearer: string
  ) => Promise<unknown>;
}

function registerUcpTool(tool: UcpToolDef): void {
  server.tool(
    {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (args) => asText(await tool.run(args as never, ucpDeps))
  );
}

function registerLaneTool(tool: LaneToolDef): void {
  server.tool(
    {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (args, ctx) =>
      asText(await tool.run(args as never, laneDeps, ctx.auth.accessToken))
  );
}

// The mcp-use CLI imports this server and owns the MCP socket.
export default server;
