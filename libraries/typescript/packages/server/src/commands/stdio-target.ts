/**
 * Parse a saved stdio target string into `{ command, args }`.
 *
 * Uses shell-like quoting (single/double quotes and backslash escapes) so
 * executable paths and arguments that contain spaces survive tokenization.
 * This intentionally does not execute shell syntax.
 */

/** Parsed stdio executable and argv from a connect target string. */
export interface StdioTarget {
  /** Executable path or program name. */
  command: string;
  /** Arguments passed to {@link StdioTarget.command}. */
  args: string[];
}

/**
 * Split a stdio connect target into command and argv.
 *
 * @param target - Raw command line from `mcp-use client connect … --stdio`.
 * @returns Executable plus argument list with quotes removed.
 */
export function parseStdioTarget(target: string): StdioTarget {
  const parts = splitCommandLine(target);

  if (parts.length === 0 || parts[0] === "") {
    throw new Error("Stdio command cannot be empty");
  }

  const [command, ...args] = parts;
  return { command: command!, args };
}

/**
 * Format command/argv for human-readable list output so spaces round-trip
 * through {@link parseStdioTarget}.
 */
export function formatStdioTarget(command: string, args: string[]): string {
  return [command, ...args].map(shellQuoteToken).join(" ");
}

function shellQuoteToken(token: string): string {
  if (token.length === 0) {
    return '""';
  }
  if (!/[\s'"\\]/.test(token)) {
    return token;
  }
  return `"${token.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function splitCommandLine(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let tokenStarted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;

    if (char === "\\") {
      const next = input[index + 1];

      if (next === undefined || quote === "'") {
        current += char;
        tokenStarted = true;
        continue;
      }

      if (quote === '"' && (next === '"' || next === "\\")) {
        current += next;
        tokenStarted = true;
        index++;
        continue;
      }

      if (!quote && /[\s'"\\]/.test(next)) {
        current += next;
        tokenStarted = true;
        index++;
        continue;
      }

      current += char;
      tokenStarted = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        parts.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (quote) {
    throw new Error("Unterminated quote in stdio command");
  }

  if (tokenStarted) {
    parts.push(current);
  }

  return parts;
}
