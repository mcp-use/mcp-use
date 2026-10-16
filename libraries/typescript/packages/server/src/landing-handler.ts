import {
  generateLandingPage,
  type LandingMetadata,
  type LandingPageOptions,
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

/** A landing page's server renderer and the lists it reads. @internal */
export interface LandingPageRenderer {
  /**
   * Server-render the body component. The CLI-generated renderer exposes
   * `data` to the landing hooks with `__withLandingData`.
   */
  render: (data: LandingData) => string | Promise<string>;
  /**
   * Lists the page reads through hooks, found from its imports at build or
   * dev time. Only listed keys are included in the rendered and serialized
   * data; `server` always is.
   */
  dataKeys: readonly LandingDataKey[];
  /**
   * The page module's `metadata` export, unvalidated. Fields that are not
   * strings are ignored with a warning when the document head is rendered.
   */
  metadata?: unknown;
}

/** Development source of a landing renderer, loaded for each render. @internal */
export interface LandingPageLoader {
  /**
   * Load the current version of the page before each render. A render uses
   * the keys and the component of one load, so an edit that lands mid-render
   * cannot pair a newly imported hook with data that lacks its list.
   */
  load: () => Promise<LandingPageRenderer>;
}

/**
 * Built or development rendering supplied by the CLI: a fixed renderer for
 * a built page, or a loader for a dev server.
 *
 * @internal
 */
export type LandingPageRegistration = LandingPageAssets &
  (LandingPageRenderer | LandingPageLoader);

/** Browser assets and serving options of a CLI-supplied landing page. @internal */
export interface LandingPageAssets {
  /** Browser hydration module: full URL, root path, or landing-relative path. */
  entry: string;
  /** Browser stylesheet URLs, with the same path rules as `entry`. */
  css?: readonly string[];
  /** Scripts loaded before `entry`, such as Vite's development client. */
  scripts?: readonly string[];
  /** Disable HTML caching and use Vite middleware for module assets. */
  dev?: boolean;
  /** Project directory containing `.mcp-use/build/landing` and `public`. */
  projectRoot?: string;
}

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

const METADATA_FIELDS = ["title", "description", "icon", "image"] as const;

/** Warnings already printed, so cached and reloaded renders do not repeat them. */
const reportedMetadataWarnings = new Set<string>();

function warnMetadata(message: string): void {
  if (reportedMetadataWarnings.has(message)) return;
  reportedMetadataWarnings.add(message);
  console.warn(`[mcp-use] landing.tsx metadata: ${message}`);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : typeof value;
}

/**
 * Keep the string fields of a page's `metadata` export. The export comes
 * from user code at runtime, so anything else is ignored with a warning
 * instead of failing the render. Empty strings count as absent.
 */
function readLandingMetadata(value: unknown): LandingMetadata {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnMetadata(
      `expected an object, got ${describeType(value)}; ignoring it.`
    );
    return {};
  }
  const metadata: LandingMetadata = {};
  for (const field of METADATA_FIELDS) {
    const fieldValue = (value as Record<string, unknown>)[field];
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== "string") {
      warnMetadata(
        `${field} must be a string, got ${describeType(fieldValue)}; ignoring it.`
      );
      continue;
    }
    if (fieldValue !== "") metadata[field] = fieldValue;
  }
  return metadata;
}

/**
 * Resolve a metadata icon or image. A value with a URL scheme is kept as is
 * and a protocol-relative `//host/...` URL takes the page's scheme; anything
 * else is a path under `public/`, with or without a leading slash. A value
 * that does not parse is ignored with a warning, so the default applies.
 */
function publicFileUrl(
  field: "icon" | "image",
  value: string,
  publicBaseUrl: string
): string | undefined {
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  try {
    // URL parsing reads a backslash as a slash, so `\\host` is
    // protocol-relative too.
    if (/^[\\/]{2}/.test(value)) return new URL(value, publicBaseUrl).href;
    return new URL(value.replace(/^[\\/]/, ""), publicBaseUrl).href;
  } catch {
    warnMetadata(`${field} is not a valid URL or public path; ignoring it.`);
    return undefined;
  }
}

function renderDocument(
  data: LandingData,
  markup: string,
  registration: LandingPageRegistration,
  metadata: LandingMetadata,
  serverOrigin: string,
  assetsBase: string,
  basePath: string
): string {
  const { server } = data;
  const name = server.title ?? server.name;
  const description =
    metadata.description ??
    (server.description ||
      `${name} MCP Server — Connect with Claude Code, Cursor, and VS Code. Model Context Protocol server.`);
  const title =
    metadata.title ??
    `${name} MCP Server — Connect with Claude Code, Cursor & VS Code`;
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
  const iconUrl =
    metadata.icon === undefined
      ? undefined
      : publicFileUrl("icon", metadata.icon, server.publicBaseUrl);
  const icon =
    iconUrl !== undefined
      ? `<link rel="icon" href="${escapeHtml(iconUrl)}">`
      : server.iconUrl
        ? `<link rel="icon"${server.iconType ? ` type="${escapeHtml(server.iconType)}"` : ""} href="${escapeHtml(server.iconUrl)}">`
        : "";
  const imageUrl =
    metadata.image === undefined
      ? undefined
      : publicFileUrl("image", metadata.image, server.publicBaseUrl);
  const image = imageUrl === undefined ? undefined : escapeHtml(imageUrl);
  const imageTags =
    image === undefined
      ? ""
      : `<meta property="og:image" content="${image}">
<meta name="twitter:image" content="${image}">
`;
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
<meta name="twitter:card" content="${image === undefined ? "summary" : "summary_large_image"}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${imageTags}${icon}
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
 * @param registration - CLI-supplied `landing.tsx` page; without one, the
 *   built-in page is rendered.
 * @param cache - Rendered custom documents keyed by MCP URL and asset base,
 *   reused unless the registration is in dev mode.
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
              const { render, dataKeys, metadata } =
                "load" in registration
                  ? await registration.load()
                  : registration;
              const data = landingData(dataKeys);
              return renderDocument(
                data,
                await render(data),
                registration,
                readLandingMetadata(metadata),
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
