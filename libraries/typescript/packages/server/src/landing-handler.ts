import {
  generateLandingPage,
  type LandingPageOptions,
  type LandingPagePrompt,
  type LandingPageResource,
  type LandingPageTool,
} from "./landing.js";
import type { ServerBranding } from "./branding.js";
import { resolveServerOrigin } from "./views/origin.js";

/**
 * Render a landing-page response without loading the renderer on MCP requests.
 *
 * @param request - Classified HTML GET or HEAD request.
 * @param basePath - Exact MCP endpoint path.
 * @param config - Server identity and description.
 * @param branding - Normalized browser and MCP identity branding.
 * @param tools - Frozen tool registry values.
 * @param prompts - Frozen prompt registry values.
 * @param resources - Frozen static-resource registry values.
 * @returns HTML response, with an empty body for HEAD.
 *
 * @internal
 */
export function createLandingPageResponse(
  request: Request,
  basePath: string,
  config: Pick<
    LandingPageOptions,
    "name" | "title" | "version" | "description"
  >,
  branding: Pick<ServerBranding, "favicon" | "faviconMimeType">,
  tools: Iterable<{ definition: LandingPageTool }>,
  prompts: Iterable<{ definition: LandingPagePrompt }>,
  resources: Iterable<{ definition: LandingPageResource }>
): Response {
  const origin = resolveServerOrigin(request);
  const url = new URL(basePath, `${origin}/`).href;
  const html = generateLandingPage({
    ...config,
    url,
    ...(branding.favicon !== undefined && {
      iconUrl: new URL("/favicon.ico", `${origin}/`).href,
      ...(branding.faviconMimeType !== undefined && {
        iconType: branding.faviconMimeType,
      }),
    }),
    tools: Array.from(tools, (entry) => entry.definition),
    prompts: Array.from(prompts, (entry) => entry.definition),
    resources: Array.from(resources, (entry) => entry.definition),
  });
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
