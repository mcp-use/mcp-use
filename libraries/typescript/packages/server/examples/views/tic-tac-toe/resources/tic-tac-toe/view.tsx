import { useState } from "react";
import { z } from "zod";
import {
  ModelContext,
  ThemeProvider,
  ToolError,
  ViewControls,
  useSendFollowUp,
  useToolContext,
  useViewTheme,
  useViewTool,
} from "@mcp-use/server/react";

import "./view.css";

type Cell = null | "X" | "O";
type Turn = "player" | "model";
type Winner = "X" | "O" | "draw" | null;

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

const placeMarkOutputSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("placed"),
    cell: z.number().int().min(0).max(8),
    board: z.string(),
    winner: z.enum(["X", "O", "draw"]).nullable(),
    nextTurn: z.literal("player").nullable(),
  }),
  z.object({
    outcome: z.literal("not-model-turn"),
    board: z.string(),
    winner: z.enum(["X", "O", "draw"]).nullable(),
    nextTurn: z.literal("player"),
  }),
]);

const placeMarkDefinition = {
  name: "place-mark",
  title: "Place your O",
  description:
    "Place your O on the tic-tac-toe board. Cells are numbered 0-8, row-major (0 = top-left, 8 = bottom-right). Only callable on your turn.",
  inputSchema: z.object({
    cell: z
      .number()
      .int()
      .min(0)
      .max(8)
      .describe("Board cell index, 0-8 row-major"),
  }),
  outputSchema: placeMarkOutputSchema,
} as const;

const rootClass =
  "p-4 font-sans bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100";

const buttonClass =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800";

function emptyBoard(): Cell[] {
  return Array.from({ length: 9 }, () => null);
}

function getWinner(board: Cell[]): Winner {
  for (const [a, b, c] of WIN_LINES) {
    const mark = board[a];
    if (mark != null && mark === board[b] && mark === board[c]) {
      return mark;
    }
  }
  if (board.every((cell) => cell != null)) {
    return "draw";
  }
  return null;
}

/** Compact board for ModelContext / tool replies: `X.O/..X/O..`. */
function serializeBoard(board: Cell[]): string {
  const glyph = (cell: Cell | undefined) => (cell == null ? "." : cell);
  const row = (start: number) =>
    `${glyph(board[start])}${glyph(board[start + 1])}${glyph(board[start + 2])}`;
  return `${row(0)}/${row(3)}/${row(6)}`;
}

function statusLabel(turn: Turn, winner: Winner): string {
  if (winner === "X") return "You win!";
  if (winner === "O") return "Model wins!";
  if (winner === "draw") return "Draw";
  if (turn === "player") return "Your turn — tap a cell";
  return "Model is thinking…";
}

function BoardSkeleton({ pulsing }: { pulsing?: boolean }) {
  return (
    <div className={rootClass}>
      <p className="mb-4 text-lg">Setting up the board…</p>
      <div className="mx-auto grid max-w-xs grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, index) => (
          <div
            key={index}
            className={`aspect-square rounded-lg bg-neutral-200 dark:bg-neutral-800${
              pulsing ? " animate-pulse" : ""
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function StatusBanner({ turn, winner }: { turn: Turn; winner: Winner }) {
  return (
    <p className="m-0 text-base font-medium" aria-live="polite">
      {statusLabel(turn, winner)}
    </p>
  );
}

function CellButton({
  index,
  value,
  disabled,
  onClick,
}: {
  index: number;
  value: Cell;
  disabled: boolean;
  onClick: () => void;
}) {
  const label =
    value == null ? `Cell ${index}, empty` : `Cell ${index}, ${value}`;

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex aspect-square items-center justify-center rounded-lg border border-neutral-300 bg-neutral-50 text-4xl font-semibold transition-colors hover:bg-neutral-100 disabled:cursor-default disabled:hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:hover:bg-neutral-800 dark:disabled:hover:bg-neutral-900"
    >
      {value != null ? (
        <span className="mark-pop" aria-hidden="true">
          {value}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Interactive board. Mounted only when `start-game` is ready so
 * `useState(firstMove)` seeds turn once without resetting on parent re-renders.
 */
function TicTacToeGame({ firstMove }: { firstMove: Turn }) {
  const theme = useViewTheme();
  const sendFollowUp = useSendFollowUp();

  const [board, setBoard] = useState<Cell[]>(emptyBoard);
  const [turn, setTurn] = useState<Turn>(firstMove);

  const winner = getWinner(board);
  const gameOver = winner !== null;

  // Ephemeral tool the model calls to place O. Keep it discoverable for the
  // entire view lifetime; the handler enforces whether a move is currently
  // legal and always sees the latest React state.
  useViewTool<typeof placeMarkDefinition>(
    placeMarkDefinition,
    async ({ cell }) => {
      if (turn !== "model") {
        return {
          content: [
            {
              type: "text",
              text: "Not the model's turn — wait for the player to place X.",
            },
          ],
          structuredContent: {
            outcome: "not-model-turn" as const,
            board: serializeBoard(board),
            winner,
            nextTurn: "player" as const,
          },
        };
      }
      if (winner !== null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Game is over (${winner}). Start a new game.`,
            },
          ],
        };
      }

      const occupied = board[cell];
      if (occupied === undefined) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid cell ${cell}.` }],
        };
      }
      if (occupied !== null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Cell ${cell} is already occupied by ${occupied}.`,
            },
          ],
        };
      }

      const nextBoard = board.map((mark, index) =>
        index === cell ? ("O" as const) : mark
      );
      const nextWinner = getWinner(nextBoard);
      setBoard(nextBoard);
      if (nextWinner === null) {
        setTurn("player");
      }

      let text = `Placed O in cell ${cell}. Board: ${serializeBoard(nextBoard)}.`;
      if (nextWinner === "O") text += " Model wins!";
      else if (nextWinner === "X") text += " Player wins!";
      else if (nextWinner === "draw") text += " Draw.";
      else text += " Player's turn.";

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          outcome: "placed" as const,
          cell,
          board: serializeBoard(nextBoard),
          winner: nextWinner,
          nextTurn: nextWinner === null ? ("player" as const) : null,
        },
      };
    }
  );

  const root = theme === "dark" ? `dark ${rootClass}` : rootClass;

  const modelContext = [
    `tic-tac-toe board (row-major 0-8): ${serializeBoard(board)}`,
    `turn: ${turn}`,
    `status: ${winner ?? "in-progress"}`,
    "You are O. Call place-mark with cell 0-8 on your turn.",
  ].join("\n");

  function placePlayerMark(index: number) {
    if (turn !== "player" || winner !== null) return;
    const occupied = board[index];
    if (occupied !== null && occupied !== undefined) return;

    const nextBoard = board.map((mark, i) =>
      i === index ? ("X" as const) : mark
    );
    const nextWinner = getWinner(nextBoard);
    setBoard(nextBoard);

    if (nextWinner === null) {
      setTurn("model");
      void sendFollowUp({
        prompt: `I played cell ${index} in tic-tac-toe. Your move — call the place-mark tool with your chosen cell.`,
      });
    }
  }

  function newGame() {
    setBoard(emptyBoard());
    setTurn("player");
  }

  return (
    <div className={root}>
      <ModelContext content={modelContext} />

      <header className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBanner turn={turn} winner={winner} />
        {gameOver ? (
          <button
            type="button"
            className={`${buttonClass} ml-auto`}
            onClick={newGame}
          >
            New game
          </button>
        ) : null}
      </header>

      <div
        className="mx-auto grid max-w-xs grid-cols-3 gap-2"
        role="grid"
        aria-label="Tic-tac-toe board"
      >
        {board.map((value, index) => {
          const cellDisabled = gameOver || turn !== "player" || value != null;
          return (
            <CellButton
              key={index}
              index={index}
              value={value ?? null}
              disabled={cellDisabled}
              onClick={() => {
                placePlayerMark(index);
              }}
            />
          );
        })}
      </div>

      <p className="mt-4 mb-0 text-center text-xs text-neutral-500 dark:text-neutral-400">
        You are X · Model is O
      </p>
    </div>
  );
}

function TicTacToeContent() {
  const view = useToolContext<"start-game">();
  const theme = useViewTheme();
  const root = theme === "dark" ? `dark ${rootClass}` : rootClass;

  if (view.status === "streaming") {
    return <BoardSkeleton pulsing />;
  }

  if (view.status === "cancelled") {
    return (
      <div className={root}>
        <p className="m-0 font-medium">Game cancelled</p>
        {typeof view.reason === "string" && view.reason.length > 0 ? (
          <p className="mt-2 mb-0 text-sm text-neutral-600 dark:text-neutral-400">
            {view.reason}
          </p>
        ) : null}
      </div>
    );
  }

  if (view.status === "error") {
    return (
      <div className={root} role="alert">
        <p className="m-0 font-medium">
          {view.error instanceof ToolError
            ? "Failed to start game"
            : "Invalid tool result"}
        </p>
        <p className="mt-2 mb-0 text-sm text-neutral-600 dark:text-neutral-400">
          {view.error.message}
        </p>
      </div>
    );
  }

  if (view.status === "pending") {
    return <BoardSkeleton />;
  }

  // Mount game only when ready so `useState(firstMove)` seeds once.
  return <TicTacToeGame firstMove={view.toolOutput.firstMove} />;
}

/**
 * Tic-tac-toe against the model. The host tool `start-game` opens this view;
 * the model places O via the ephemeral `place-mark` view tool.
 */
export default function TicTacToe() {
  return (
    <ThemeProvider>
      <ViewControls debugger>
        <TicTacToeContent />
      </ViewControls>
    </ThemeProvider>
  );
}
