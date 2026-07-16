/**
 * Module-scope MCPServer, shared by the Vercel Function entry (`api/mcp.ts`)
 * and the local smoke test (`smoke.ts`).
 *
 * `MCPServer` builds a fresh SDK server per HTTP request off this registry
 * (see `getHandler()` in `mcp-use`), so the whole module is stateless
 * and safe to reuse across warm serverless invocations — register everything
 * once, at import time, and never after `getHandler()` is called.
 */
import { MCPServer } from "mcp-use";
import { z } from "zod";

export const server = new MCPServer({
  name: "vercel-example",
  version: "1.0.0",
  title: "mcp-use on Vercel",
  description:
    "Minimal MCP server demonstrating mcp-use on Vercel serverless functions.",
  // Vercel serves files under api/ at a matching /api/* path; aligning
  // basePath with the function's file location (api/mcp.ts) means the
  // mounted route is exactly what Vercel routes to it. Getting this out of
  // sync (e.g. leaving the "/mcp" default) is a silent 404 trap.
  //
  // No allowedHosts needed: `getHandler()` applies no Host validation, and
  // Vercel's edge only routes hostnames assigned to this deployment, so
  // DNS-rebinding-style Hosts never reach the function. Set `allowedHosts`
  // (additive — localhost stays allowed) to opt into stricter validation.
  basePath: "/api/mcp",
});

const temperatureUnit = z.enum(["celsius", "fahrenheit"]);

server.tool(
  {
    name: "convert-temperature",
    title: "Convert temperature",
    description: "Convert a temperature value between Celsius and Fahrenheit",
    inputSchema: z.object({
      value: z.number().describe("The temperature value to convert"),
      from: temperatureUnit.describe("The unit of the input value"),
    }),
    outputSchema: z.object({
      value: z.number(),
      from: temperatureUnit,
      to: temperatureUnit,
      result: z.number(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ value, from }) => {
    const to: "celsius" | "fahrenheit" =
      from === "celsius" ? "fahrenheit" : "celsius";
    const raw =
      from === "celsius" ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9;
    const data = { value, from, to, result: Math.round(raw * 100) / 100 };
    // Tools with an outputSchema return the payload twice: machine-readable
    // structuredContent plus a text serialization for content-only clients.
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);

server.tool(
  {
    name: "roll-dice",
    title: "Roll dice",
    description: "Roll one or more dice and report the results",
    inputSchema: z.object({
      sides: z
        .number()
        .int()
        .min(2)
        .max(1000)
        .optional()
        .describe("Number of sides per die (default 6)"),
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of dice to roll (default 1)"),
    }),
  },
  async ({ sides, count }) => {
    const numSides = sides ?? 6;
    const numDice = count ?? 1;
    const rolls = Array.from(
      { length: numDice },
      () => 1 + Math.floor(Math.random() * numSides)
    );
    const total = rolls.reduce((sum, roll) => sum + roll, 0);
    return {
      content: [
        {
          type: "text",
          text: `Rolled ${numDice}d${numSides}: ${rolls.join(", ")} (total ${total})`,
        },
      ],
    };
  }
);

server.resource(
  {
    name: "deployment-info",
    uri: "vercel://deployment",
    title: "Deployment info",
    description:
      "The serverless environment serving this request (empty/local values outside Vercel)",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          environment: process.env["VERCEL_ENV"] ?? "development",
          region: process.env["VERCEL_REGION"] ?? "local",
          url: process.env["VERCEL_URL"] ?? "localhost",
        }),
      },
    ],
  })
);
