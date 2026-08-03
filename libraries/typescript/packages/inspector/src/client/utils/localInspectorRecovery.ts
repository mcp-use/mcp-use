const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const HOSTED_CALLBACK_REJECTION_PATTERNS = [
  /invalid_redirect_uri/i,
  /redirect_uri_mismatch/i,
  /redirect uri (?:is )?not allowed/i,
  /redirect (?:uri|url).*(?:not registered|not permitted|rejected)/i,
];

export function shouldSuggestLocalInspector(
  error: string,
  inspectorHostname: string
): boolean {
  const normalizedHostname = inspectorHostname
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();

  if (!normalizedHostname || LOOPBACK_HOSTNAMES.has(normalizedHostname)) {
    return false;
  }

  return HOSTED_CALLBACK_REJECTION_PATTERNS.some((pattern) =>
    pattern.test(error)
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildLocalInspectorCommand(serverUrl: string): string {
  return `npx @mcp-use/inspector --url ${shellQuote(serverUrl)}`;
}
