import type {
  CspViolation,
  WidgetDeclaredCsp,
} from "@/client/context/WidgetDebugContext";

export function computeSuggestedFix(
  violations: CspViolation[],
  currentDeclared?: WidgetDeclaredCsp
): {
  connectDomains: string[];
  resourceDomains: string[];
  frameDomains?: string[];
} {
  const connectSet = new Set(currentDeclared?.connectDomains ?? []);
  const resourceSet = new Set(currentDeclared?.resourceDomains ?? []);
  const frameSet = new Set(currentDeclared?.frameDomains ?? []);

  const RESOURCE_DIRECTIVES = new Set([
    "script-src",
    "style-src",
    "img-src",
    "font-src",
    "media-src",
  ]);
  const CONNECT_DIRECTIVE = "connect-src";
  const FRAME_DIRECTIVE = "frame-src";

  for (const v of violations) {
    const uri = (v.blockedUri || "").trim();
    if (
      !uri ||
      uri === "(inline)" ||
      uri.startsWith("blob:") ||
      uri.startsWith("data:")
    ) {
      continue;
    }
    let origin: string | null = null;
    try {
      const url = new URL(uri);
      origin = url.origin;
    } catch {
      continue;
    }
    if (!origin) continue;

    const dir = (v.effectiveDirective || v.directive || "").toLowerCase();

    if (dir === CONNECT_DIRECTIVE) {
      connectSet.add(origin);
      if (origin.startsWith("http://")) {
        connectSet.add(origin.replace("http://", "ws://"));
      } else if (origin.startsWith("https://")) {
        connectSet.add(origin.replace("https://", "wss://"));
      }
    } else if (RESOURCE_DIRECTIVES.has(dir)) {
      resourceSet.add(origin);
    } else if (dir === FRAME_DIRECTIVE) {
      frameSet.add(origin);
    }
  }

  const result: {
    connectDomains: string[];
    resourceDomains: string[];
    frameDomains?: string[];
  } = {
    connectDomains: Array.from(connectSet).sort(),
    resourceDomains: Array.from(resourceSet).sort(),
  };
  if (frameSet.size > 0) {
    result.frameDomains = Array.from(frameSet).sort();
  }
  return result;
}

const MCP_APPS_CSP_SPEC_URL =
  "https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/bcfffb6585ea4fb1e3a9da39fb8911b83399fa71/specification/2026-01-26/apps.mdx";
const MCP_USE_CSP_DOCS_URL = "https://mcp-use.com/docs/typescript/server/csp";

/**
 * Build an agent prompt to fix CSP violations.
 * Includes context, current CSP, violations, and suggested fix for an agent to apply.
 * Only call when violations.length > 0.
 */
export function buildAgentCspPrompt(
  declaredCsp: WidgetDeclaredCsp | undefined,
  effectivePolicy: string | undefined,
  violations: CspViolation[],
  suggestedFix: {
    connectDomains: string[];
    resourceDomains: string[];
    frameDomains?: string[];
  } | null
): string {
  const lines: string[] = [
    "Fix the Content Security Policy (CSP) for this MCP Apps widget. The widget has CSP violations that block network requests and resources.",
    "",
    "**References:**",
    `- MCP Apps CSP spec: ${MCP_APPS_CSP_SPEC_URL}`,
    `- mcp-use CSP docs: ${MCP_USE_CSP_DOCS_URL}`,
    "",
  ];

  lines.push("**Current declared CSP:**");
  if (declaredCsp) {
    lines.push(
      `connectDomains: ${JSON.stringify(declaredCsp.connectDomains ?? [])}`
    );
    lines.push(
      `resourceDomains: ${JSON.stringify(declaredCsp.resourceDomains ?? [])}`
    );
    lines.push(
      `frameDomains: ${JSON.stringify(declaredCsp.frameDomains ?? [])}`
    );
    lines.push(
      `baseUriDomains: ${JSON.stringify(declaredCsp.baseUriDomains ?? [])}`
    );
  } else {
    lines.push("No CSP declared.");
  }
  lines.push("");

  if (effectivePolicy) {
    lines.push("**Effective policy (originalPolicy):**");
    lines.push("```");
    lines.push(effectivePolicy);
    lines.push("```");
    lines.push("");
  }

  if (violations.length > 0) {
    lines.push(`**Blocked requests (${violations.length}):**`);
    for (const v of violations) {
      const dir = v.effectiveDirective || v.directive;
      const uri = v.blockedUri || "(inline)";
      lines.push(`- ${dir}: ${uri}`);
    }
    lines.push("");
  }

  if (suggestedFix) {
    lines.push("**Apply this CSP config to fix the violations:**");
    lines.push(
      "Add these domains to the widget's CSP metadata (resource _meta.ui.csp). Use camelCase for MCP Apps (connectDomains, resourceDomains)."
    );
    lines.push("");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        {
          connectDomains: suggestedFix.connectDomains,
          resourceDomains: suggestedFix.resourceDomains,
          ...(suggestedFix.frameDomains?.length
            ? { frameDomains: suggestedFix.frameDomains }
            : {}),
        },
        null,
        2
      )
    );
    lines.push("```");
  } else {
    lines.push("No blocked requests - no fix needed.");
  }

  return lines.join("\n");
}

