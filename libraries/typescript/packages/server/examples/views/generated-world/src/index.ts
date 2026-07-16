/**
 * Generated World — model-authored Three.js worlds in an ephemeral sandbox.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { createHash } from "node:crypto";
import { MCPServer } from "mcp-use";
import { z } from "zod";

import { WORLD_GUIDE } from "./world-guide.js";

const BASE_PATH = "/mcp";
const MAX_SOURCE_BYTES = 180 * 1024;

const server = new MCPServer({
  name: "generated-world",
  version: "1.0.0",
  title: "Generated World",
  legacy: "stateless",
  logging: { level: "debug" },
  description:
    "Generate an ephemeral Three.js environment and explore it with a flying camera.",
  basePath: BASE_PATH,
});

const worldOutputSchema = z.object({
  worldId: z.string(),
  title: z.string(),
  source: z.string(),
  seed: z.number().int(),
});

/** Model-facing reference for the generated-world source contract. */
export const readWorldGuide = server.tool(
  {
    name: "read_world_guide",
    title: "Read generated-world guide",
    description:
      "Read the JavaScript contract and safety limits for render_world. Call this before rendering a world for the first time.",
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text", text: WORLD_GUIDE }],
  })
);

/** Returns one ephemeral generated world to its bound MCP App view. */
export const renderWorld = server.tool(
  {
    name: "render_world",
    title: "Generate 3D world",
    description: `Render a complete interactive Three.js environment from model-generated JavaScript.
Call read_world_guide first. Generate the source directly into the source argument.
Build an open-top environment with absolutely no roofs, ceilings, fog, or other visual obstructions so its streamed construction remains visible from the elevated camera.
The source is ephemeral: the MCP server returns it in the same tool result and does not persist it or call a separate upload service.
Syntax and runtime failures are reported by the sandboxed viewer so the world can be revised.
The user explores with a flying camera (WASD, Q/E, drag to look, Shift to boost).`,
    inputSchema: z.object({
      title: z
        .string()
        .min(1)
        .max(120)
        .describe("Short human-readable name for the generated environment"),
      source: z
        .string()
        .min(1)
        .describe(
          "Body of async buildWorld({ THREE, scene, random, onFrame }). Follow read_world_guide: build near the origin with absolutely no roofs, ceilings, fog, or overhead geometry; do not include a function wrapper, imports, exports, markdown, HTML, browser globals, network calls, timers, camera, renderer, or render loop. These are authoring instructions rather than server-side rejections; the viewer reports syntax and runtime failures."
        ),
      seed: z
        .number()
        .int()
        .min(0)
        .max(0xffffffff)
        .optional()
        .describe("Optional deterministic unsigned 32-bit random seed"),
    }),
    outputSchema: worldOutputSchema,
    annotations: { readOnlyHint: true },
    view: {
      name: "generated-world",
      description: "Fly through a model-generated Three.js environment",
      prefersBorder: false,
      csp: {
        resourceDomains: ["https://esm.sh"],
        connectDomains: ["https://esm.sh"],
        frameDomains: ["blob:"],
      },
    },
  },
  async ({ title, source, seed }) => {
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `World source exceeds the ${MAX_SOURCE_BYTES} byte limit.`,
          },
        ],
      };
    }

    const digest = createHash("sha256")
      .update(title)
      .update("\0")
      .update(source)
      .digest();
    const worldId = digest.toString("hex").slice(0, 18);
    const resolvedSeed = seed ?? digest.readUInt32BE(0);

    return {
      content: [
        {
          type: "text",
          text: `Generated world "${title}" was sent to the sandboxed viewer. Viewer errors will identify anything that needs revision. This app did not persist it or send it to a separate upload service.`,
        },
      ],
      structuredContent: {
        worldId,
        title,
        source,
        seed: resolvedSeed,
      },
    };
  }
);

/** v2 MCP server used by the generated-world reference app. */
export default server;
