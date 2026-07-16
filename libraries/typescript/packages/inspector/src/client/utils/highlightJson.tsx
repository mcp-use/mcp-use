import type { ReactNode } from "react";

type JsonTokenKind =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation";

interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const TOKEN_CLASS: Record<JsonTokenKind, string> = {
  key: "text-sky-600 dark:text-sky-400",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  boolean: "text-violet-600 dark:text-violet-400",
  null: "text-zinc-500 dark:text-zinc-400",
  punctuation: "text-muted-foreground",
};

/** Tokenize pretty-printed JSON for syntax highlighting. */
export function tokenizeJson(formatted: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = 0;

  const push = (kind: JsonTokenKind, text: string) => {
    if (text) tokens.push({ kind, text });
  };

  while (i < formatted.length) {
    const ch = formatted[i];

    if (ch === '"') {
      const start = i;
      i++;
      while (i < formatted.length) {
        if (formatted[i] === "\\") {
          i += 2;
          continue;
        }
        if (formatted[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      const raw = formatted.slice(start, i);
      let j = i;
      while (j < formatted.length && /[ \t]/.test(formatted[j])) j++;
      const isKey = formatted[j] === ":";
      push(isKey ? "key" : "string", raw);
      continue;
    }

    if (/[0-9-]/.test(ch)) {
      const start = i;
      if (formatted[i] === "-") i++;
      while (i < formatted.length && /[0-9.eE+-]/.test(formatted[i])) i++;
      push("number", formatted.slice(start, i));
      continue;
    }

    if (formatted.startsWith("true", i) || formatted.startsWith("false", i)) {
      const word = formatted.startsWith("true", i) ? "true" : "false";
      push("boolean", word);
      i += word.length;
      continue;
    }

    if (formatted.startsWith("null", i)) {
      push("null", "null");
      i += 4;
      continue;
    }

    if (/[{}[\],:]/.test(ch)) {
      push("punctuation", ch);
      i++;
      continue;
    }

    push("punctuation", ch);
    i++;
  }

  return tokens;
}

export function highlightJson(formatted: string): ReactNode[] {
  return tokenizeJson(formatted).map((token, index) => (
    <span key={index} className={TOKEN_CLASS[token.kind]}>
      {token.text}
    </span>
  ));
}
