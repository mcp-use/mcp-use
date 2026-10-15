import {
  generateLandingPage,
  type LandingPageOptions,
  type LandingPageRegistration,
  type LandingPagePrompt,
  type LandingPageResource,
  type LandingPageTool,
} from "./landing.js";
import type {
  LandingData,
  LandingDataKey,
  LandingServerInfo,
} from "./landing-data.js";
import type { ServerBranding } from "./branding.js";
import { resolveAssetsBase, resolveServerOrigin } from "./views/origin.js";

const MAX_CACHED_DOCUMENTS = 32;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function assetUrl(
  value: string,
  serverOrigin: string,
  assetsBase: string,
  basePath: string
): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${serverOrigin}${value}`;
  const prefix = basePath === "/" ? "" : basePath;
  return `${assetsBase}${prefix}/_mcp-use/landing/${value}`;
}

function renderDocument(
  data: LandingData,
  markup: string,
  registration: LandingPageRegistration,
  serverOrigin: string,
  assetsBase: string,
  basePath: string
): string {
  const { server } = data;
  const name = server.title ?? server.name;
  const description =
    server.description ||
    `${name} MCP Server — Connect with Claude Code, Cursor, and VS Code. Model Context Protocol server.`;
  const title = `${name} MCP Server — Connect with Claude Code, Cursor & VS Code`;
  const scripts = [...(registration.scripts ?? []), registration.entry]
    .map(
      (value) =>
        `<script type="module" src="${escapeHtml(assetUrl(value, serverOrigin, assetsBase, basePath))}"></script>`
    )
    .join("\n");
  const stylesheets = (registration.css ?? [])
    .map(
      (value) =>
        `<link rel="stylesheet" href="${escapeHtml(assetUrl(value, serverOrigin, assetsBase, basePath))}">`
    )
    .join("\n");
  const icon = server.iconUrl
    ? `<link rel="icon"${server.iconType ? ` type="${escapeHtml(server.iconType)}"` : ""} href="${escapeHtml(server.iconUrl)}">`
    : "";
  const jsonLd = serializeScriptJson({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name,
    softwareVersion: server.version,
    description,
    applicationCategory: "DeveloperApplication",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${icon}
<script type="application/ld+json">${jsonLd}</script>
${stylesheets}
</head>
<body>
<div id="mcp-use-landing-root">${markup}</div>
<script id="mcp-use-landing-data" type="application/json">${serializeScriptJson(data)}</script>
${scripts}
</body>
</html>`;
}

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
export async function createLandingPageResponse(
  request: Request,
  basePath: string,
  config: Pick<
    LandingPageOptions,
    "name" | "title" | "version" | "description"
  >,
  branding: Pick<ServerBranding, "favicon" | "faviconMimeType" | "websiteUrl">,
  tools: Iterable<{ definition: LandingPageTool }>,
  prompts: Iterable<{ definition: LandingPagePrompt }>,
  resources: Iterable<{ definition: LandingPageResource }>,
  registration?: LandingPageRegistration,
  cache?: Map<string, Promise<string>>
): Promise<Response> {
  const origin = resolveServerOrigin(request);
  const url = new URL(basePath, `${origin}/`).href;
  const assetsBase = resolveAssetsBase(request);
  const basePrefix = basePath === "/" ? "" : basePath;
  const server: LandingServerInfo = {
    name: config.name,
    ...(config.title !== undefined && { title: config.title }),
    version: config.version,
    ...(config.description !== undefined && {
      description: config.description,
    }),
    url,
    ...(branding.websiteUrl !== undefined && {
      websiteUrl: branding.websiteUrl,
    }),
    ...(branding.favicon !== undefined && {
      iconUrl: new URL("/favicon.ico", `${origin}/`).href,
      ...(branding.faviconMimeType !== undefined && {
        iconType: branding.faviconMimeType,
      }),
    }),
    publicBaseUrl: `${assetsBase}${basePrefix}/_mcp-use/public/`,
  };
  const listTools = (): LandingPageTool[] =>
    Array.from(tools, ({ definition }) => ({
      name: definition.name,
      ...(definition.title !== undefined && { title: definition.title }),
      ...(definition.description !== undefined && {
        description: definition.description,
      }),
    }));
  const listPrompts = (): LandingPagePrompt[] =>
    Array.from(prompts, ({ definition }) => ({
      name: definition.name,
      ...(definition.title !== undefined && { title: definition.title }),
      ...(definition.description !== undefined && {
        description: definition.description,
      }),
    }));
  const listResources = (): LandingPageResource[] =>
    Array.from(resources, ({ definition }) => ({
      uri: definition.uri,
      ...(definition.name !== undefined && { name: definition.name }),
      ...(definition.title !== undefined && { title: definition.title }),
      ...(definition.description !== undefined && {
        description: definition.description,
      }),
    }));
  // Ship only the lists the custom page imports a hook for; the built-in
  // page shows all of them.
  const landingData = (keys: readonly LandingDataKey[]): LandingData => {
    const dataKeys = new Set(keys);
    return {
      server,
      ...(dataKeys.has("tools") && { tools: listTools() }),
      ...(dataKeys.has("prompts") && { prompts: listPrompts() }),
      ...(dataKeys.has("resources") && { resources: listResources() }),
    };
  };
  const html =
    registration === undefined
      ? generateLandingPage({
          ...server,
          tools: listTools(),
          prompts: listPrompts(),
          resources: listResources(),
        })
      : request.method === "HEAD"
        ? undefined
        : await (async () => {
            const key = `${url}\u0000${assetsBase}`;
            const cached =
              registration.dev === true ? undefined : cache?.get(key);
            if (cached !== undefined) return cached;
            const rendering = (async () => {
              const { render, dataKeys } =
                "load" in registration
                  ? await registration.load()
                  : registration;
              const data = landingData(dataKeys);
              return renderDocument(
                data,
                await render(data),
                registration,
                origin,
                assetsBase,
                basePath
              );
            })();
            if (registration.dev !== true && cache !== undefined) {
              if (cache.size >= MAX_CACHED_DOCUMENTS) {
                const oldest = cache.keys().next().value;
                if (oldest !== undefined) cache.delete(oldest);
              }
              cache.set(key, rendering);
              void rendering.catch(() => {
                if (cache.get(key) === rendering) cache.delete(key);
              });
            }
            return rendering;
          })();
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
