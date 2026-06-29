export function evalJsonPath(root: unknown, path: string): unknown {
  if (path === "$") return root;
  if (!path.startsWith("$.")) {
    throw new Error(`jsonpath must start with $. or be $ — got ${path}`);
  }
  const tokens = tokenizeJsonPath(path.slice(2));
  let cur: unknown = root;
  for (const token of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof token === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[token];
    } else {
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[token];
    }
  }
  return cur;
}

function tokenizeJsonPath(path: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  const re = /([^[\].]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
  }
  return tokens;
}

export function resolveFromResultUri(uri: string, result: unknown): string {
  const prefix = "${fromResult:";
  if (!uri.startsWith(prefix) || !uri.endsWith("}")) {
    return uri;
  }
  const inner = uri.slice(prefix.length, -1);
  const resolved = evalJsonPath(result, inner.startsWith("$") ? inner : `$.${inner}`);
  if (typeof resolved !== "string") {
    throw new Error(`fromResult uri did not resolve to string: ${uri}`);
  }
  return resolved;
}
