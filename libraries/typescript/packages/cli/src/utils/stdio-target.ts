export interface StdioTarget {
  command: string;
  args: string[];
}

export function parseStdioTarget(target: string): StdioTarget {
  const parts = splitCommandLine(target);

  if (parts.length === 0) {
    throw new Error("Stdio command cannot be empty");
  }

  const [command, ...args] = parts;
  return { command, args };
}

function splitCommandLine(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let tokenStarted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];

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

      if (!quote && (/[\s'"\\]/.test(next) || next === "\\")) {
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
