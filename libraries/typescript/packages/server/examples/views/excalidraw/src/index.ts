/**
 * Excalidraw — MCP Apps views example ported from excalidraw/excalidraw-mcp.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { deflateSync } from "node:zlib";
import { MCPServer } from "@mcp-use/server";
import { z } from "zod";

import { RECALL_CHEAT_SHEET } from "./cheat-sheet.js";
import {
  FileCheckpointStore,
  type CheckpointStore,
} from "./checkpoint-store.js";

const BASE_PATH = "/mcp";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

const store: CheckpointStore = new FileCheckpointStore();

const server = new MCPServer({
  name: "excalidraw",
  version: "1.0.0",
  title: "Excalidraw",
  // "stateless" (the default) serves 2025-era clients over a session-less
  // transport instead of rejecting them outright. This example streams tool
  // input into the view (`create_view`'s `elements` argument arrives via
  // `ui/notifications/tool-input-partial`), the same pattern the public
  // story-writer example uses with `legacy: "stateless"` — streaming works
  // under either setting, but nothing here requires modern-only strict
  // serving, so match the streaming-example default rather than the
  // fruit-store example's `"reject"`.
  legacy: "stateless",
  logging: { level: "debug" },
  description:
    "Stream hand-drawn Excalidraw diagrams with camera control and fullscreen editing.",
  basePath: BASE_PATH,
});

const createViewOutputSchema = z.object({
  checkpointId: z.string(),
});

export const readMe = server.tool(
  {
    name: "read_me",
    title: "Read Excalidraw format guide",
    description:
      "Returns the Excalidraw element format reference with color palettes, examples, and tips. Call this BEFORE using create_view for the first time.",
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text", text: RECALL_CHEAT_SHEET }],
  })
);

export const createView = server.tool(
  {
    name: "create_view",
    title: "Draw Diagram",
    description: `Renders a hand-drawn diagram using Excalidraw elements.
Elements stream in one by one with draw-on animations.
Call read_me first to learn the element format.`,
    inputSchema: z.object({
      elements: z
        .string()
        .describe(
          "JSON array string of Excalidraw elements. Must be valid JSON — no comments, no trailing commas. Keep compact. Call read_me first for format reference."
        ),
    }),
    outputSchema: createViewOutputSchema,
    annotations: { readOnlyHint: true },
    view: {
      name: "excalidraw",
      description: "Interactive Excalidraw diagram view",
      prefersBorder: true,
      permissions: { clipboardWrite: {} },
      csp: {
        resourceDomains: ["https://esm.sh"],
        connectDomains: ["https://esm.sh"],
      },
    },
  },
  async ({ elements }) => {
    if (elements.length > MAX_INPUT_BYTES) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Elements input exceeds ${MAX_INPUT_BYTES} byte limit. Reduce the number of elements or use checkpoints to build incrementally.`,
          },
        ],
      };
    }

    let parsed: unknown[];
    try {
      parsed = JSON.parse(elements) as unknown[];
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Invalid JSON in elements: ${(e as Error).message}. Ensure no comments, no trailing commas, and proper quoting.`,
          },
        ],
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Invalid elements: expected a JSON array.",
          },
        ],
      };
    }

    type El = Record<string, unknown> & {
      type?: string;
      id?: string;
      ids?: string;
      containerId?: string;
      width?: number;
      height?: number;
    };
    const els = parsed as El[];

    const restoreEl = els.find((el) => el.type === "restoreCheckpoint");
    let resolvedElements: El[];

    if (typeof restoreEl?.id === "string") {
      const base = await store.load(restoreEl.id);
      if (!base) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Checkpoint "${restoreEl.id}" not found — it may have expired or never existed. Please recreate the diagram from scratch.`,
            },
          ],
        };
      }

      const deleteIds = new Set<string>();
      for (const el of els) {
        if (el.type === "delete") {
          for (const id of String(el.ids ?? el.id).split(",")) {
            deleteIds.add(id.trim());
          }
        }
      }

      const baseFiltered = (base.elements as El[]).filter(
        (el) =>
          !deleteIds.has(String(el.id)) &&
          !deleteIds.has(String(el.containerId))
      );
      const newEls = els.filter(
        (el) => el.type !== "restoreCheckpoint" && el.type !== "delete"
      );
      resolvedElements = [...baseFiltered, ...newEls];
    } else {
      resolvedElements = els.filter((el) => el.type !== "delete");
    }

    const cameras = els.filter((el) => el.type === "cameraUpdate");
    const badRatio = cameras.find((c) => {
      if (!c.width || !c.height) return false;
      const ratio = c.width / c.height;
      return Math.abs(ratio - 4 / 3) > 0.15;
    });
    const ratioHint = badRatio
      ? `\nTip: your cameraUpdate used ${badRatio.width}x${badRatio.height} — try to stick with 4:3 aspect ratio (e.g. 400x300, 800x600) in future.`
      : "";

    const checkpointId = crypto.randomUUID().replace(/-/g, "").slice(0, 18);
    await store.save(checkpointId, { elements: resolvedElements });

    return {
      content: [
        {
          type: "text",
          text: `Diagram displayed! Checkpoint id: "${checkpointId}".
If the user asks to create a new diagram, simply start a new one from scratch.
If the user instead wants to edit this diagram ("${checkpointId}"), first check this conversation for a "User edited diagram (checkpoint: ${checkpointId})…" note — the view automatically reports any manual edits the user made in fullscreen as extra context here, with no tool call needed on your part. If no such note is present, no manual edits were made.
Then decide whether you want to make a new diagram from scratch OR use this one as your starting checkpoint:
  simply start from the first element [{"type":"restoreCheckpoint","id":"${checkpointId}"}, ...your new elements...]
  this restores the same diagram state the user currently sees, including any manual edits reported above, allowing you to add elements on top.
  To remove elements, use: {"type":"delete","ids":"<id1>,<id2>"}${ratioHint}`,
        },
      ],
      structuredContent: { checkpointId },
    };
  }
);

export const exportToExcalidraw = server.tool(
  {
    name: "export_to_excalidraw",
    title: "Export to Excalidraw",
    description: "Upload diagram to excalidraw.com and return shareable URL.",
    inputSchema: z.object({
      json: z.string().describe("Serialized Excalidraw JSON"),
    }),
    visibility: "app",
  },
  async ({ json }) => {
    if (json.length > MAX_INPUT_BYTES) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Export data exceeds ${MAX_INPUT_BYTES} byte limit.`,
          },
        ],
      };
    }
    try {
      const concatBuffers = (...bufs: Uint8Array[]): Uint8Array => {
        let total = 4;
        for (const b of bufs) total += 4 + b.length;
        const out = new Uint8Array(total);
        const dv = new DataView(out.buffer);
        dv.setUint32(0, 1);
        let off = 4;
        for (const b of bufs) {
          dv.setUint32(off, b.length);
          off += 4;
          out.set(b, off);
          off += b.length;
        }
        return out;
      };
      const te = new TextEncoder();

      const fileMetadata = te.encode(JSON.stringify({}));
      const dataBytes = te.encode(json);
      const innerPayload = concatBuffers(fileMetadata, dataBytes);
      const compressed = deflateSync(Buffer.from(innerPayload));

      const cryptoKey = await globalThis.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 128 },
        true,
        ["encrypt"]
      );
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        compressed
      );

      const encodingMeta = te.encode(
        JSON.stringify({
          version: 2,
          compression: "pako@1",
          encryption: "AES-GCM",
        })
      );
      const payload = Buffer.from(
        concatBuffers(encodingMeta, iv, new Uint8Array(encrypted))
      );

      const res = await fetch("https://json.excalidraw.com/api/v2/post/", {
        method: "POST",
        body: payload,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { id } = (await res.json()) as { id: string };

      const jwk = await globalThis.crypto.subtle.exportKey("jwk", cryptoKey);
      const url = `https://excalidraw.com/#json=${id},${jwk.k}`;

      return { content: [{ type: "text", text: url }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Export failed: ${(err as Error).message}`,
          },
        ],
      };
    }
  }
);

export const saveCheckpoint = server.tool(
  {
    name: "save_checkpoint",
    title: "Save checkpoint",
    description: "Update checkpoint with user-edited state.",
    inputSchema: z.object({
      id: z.string(),
      data: z.string(),
    }),
    visibility: "app",
  },
  async ({ id, data }) => {
    if (data.length > MAX_INPUT_BYTES) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Checkpoint data exceeds ${MAX_INPUT_BYTES} byte limit.`,
          },
        ],
      };
    }
    try {
      await store.save(id, JSON.parse(data) as { elements: unknown[] });
      return { content: [{ type: "text", text: "ok" }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `save failed: ${(err as Error).message}`,
          },
        ],
      };
    }
  }
);

export const readCheckpoint = server.tool(
  {
    name: "read_checkpoint",
    title: "Read checkpoint",
    description: "Read checkpoint state for restore.",
    inputSchema: z.object({
      id: z.string(),
    }),
    visibility: "app",
  },
  async ({ id }) => {
    try {
      const data = await store.load(id);
      if (!data) return { content: [{ type: "text", text: "" }] };
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `read failed: ${(err as Error).message}`,
          },
        ],
      };
    }
  }
);

export default server;
