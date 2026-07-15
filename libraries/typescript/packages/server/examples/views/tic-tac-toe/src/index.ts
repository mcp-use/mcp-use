/**
 * Tic-Tac-Toe — MCP Apps views example where the model plays through a view tool.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { MCPServer } from "@mcp-use/server";
import { z } from "zod";

const BASE_PATH = "/mcp";

const server = new MCPServer({
  name: "tic-tac-toe",
  version: "1.0.0",
  title: "Tic-Tac-Toe",
  legacy: "stateless",
  logging: { level: "debug" },
  description:
    "Play tic-tac-toe against the model in an MCP Apps view. The model makes its moves by calling the view-registered `place-mark` tool.",
  basePath: BASE_PATH,
});

const gameSetupSchema = z.object({
  playerSymbol: z.literal("X"),
  modelSymbol: z.literal("O"),
  firstMove: z.enum(["player", "model"]),
});

export const startGame = server.tool(
  {
    name: "start-game",
    title: "Start a tic-tac-toe game",
    description:
      "Start a new tic-tac-toe game against the user in an interactive view. The user plays X by clicking cells; you play O by calling the `place-mark` view tool registered while the game view is open. Call it on your turn after checking the board state in the view's model context, and pick a cell (0-8, row-major).",
    inputSchema: z.object({
      firstMove: z
        .enum(["player", "model"])
        .optional()
        .describe("Who makes the first move. Defaults to the player."),
    }),
    outputSchema: gameSetupSchema,
    view: {
      name: "tic-tac-toe",
      description: "Interactive tic-tac-toe board",
      prefersBorder: true,
    },
  },
  async ({ firstMove = "player" }) => {
    return {
      content: [
        {
          type: "text",
          text:
            firstMove === "model"
              ? "New game started — you move first. Call `place-mark` with a cell index (0-8)."
              : "New game started — the user moves first. When it is your turn, call `place-mark` with a cell index (0-8).",
        },
      ],
      structuredContent: {
        playerSymbol: "X" as const,
        modelSymbol: "O" as const,
        firstMove,
      },
    };
  }
);

export default server;
