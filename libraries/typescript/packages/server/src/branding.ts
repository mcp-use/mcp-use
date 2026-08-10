import type { Icon } from "@modelcontextprotocol/server";

import type { FetchHandler } from "./fetch-app.js";
import { resolveAssetsBase } from "./views/origin.js";
import {
  resolvePublicFilePath,
  servePublicFile,
} from "./views/public-route.js";

const FAVICON_CACHE_CONTROL = "public, max-age=31536000, immutable";
const FAVICON_REDIRECT_CACHE_CONTROL = "public, max-age=300";

/** Normalized server branding shared by browser and MCP identity surfaces. */
export interface ServerBranding {
  /**
   * Source selected for `/favicon.ico`, after applying explicit-favicon and
   * first-icon inference.
   */
  readonly favicon?: string;
  /** MIME type of the selected favicon when known. */
  readonly faviconMimeType?: string;
  /** Icons reported in MCP implementation metadata, in author order. */
  readonly icons?: readonly Icon[];
  /** Server website reported in MCP implementation metadata. */
  readonly websiteUrl?: string;
}

function protocolOf(value: string): string | undefined {
  const match = /^([a-z][a-z\d+.-]*):/i.exec(value);
  return match?.[1]?.toLowerCase();
}

function publicAssetPath(basePath: string, source: string): string {
  const prefix = basePath === "/" ? "" : basePath;
  return `${prefix}/_mcp-use/public/${source
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function isLocalPublicSource(source: string): boolean {
  return protocolOf(source) === undefined;
}

/**
 * Select the browser favicon from an ordered set of MCP icons.
 *
 * Uses the first icon in author order. Put the preferred browser favicon
 * first, or set {@link ServerConfig.favicon} explicitly.
 *
 * @param icons - Validated, non-empty icon list.
 * @returns The selected icon.
 *
 * @internal
 */
function selectFaviconFromIcons(icons: readonly Icon[]): Icon | undefined {
  return icons[0];
}

function assertLocalPublicSource(source: string, field: string): void {
  if (
    source.startsWith("/") ||
    source.includes("\\") ||
    source.includes("?") ||
    source.includes("#") ||
    source.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new TypeError(
      `${field} must be an http(s) URL, image data URL, or safe path relative to public/`
    );
  }
}

interface ParsedDataImage {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: string;
}

function parseDataImage(source: string, field: string): ParsedDataImage {
  const comma = source.indexOf(",");
  if (comma < 0) {
    throw new TypeError(`${field} must be a valid image data URL`);
  }
  const metadata = source.slice(5, comma);
  const payload = source.slice(comma + 1);
  const parts = metadata.split(";");
  const mimeType = parts[0]?.toLowerCase() ?? "";
  if (!mimeType.startsWith("image/")) {
    throw new TypeError(`${field} data URL must use an image MIME type`);
  }
  try {
    if (parts.includes("base64")) {
      const binary = atob(payload);
      return {
        mimeType,
        bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      };
    }
    return {
      mimeType,
      bytes: new TextEncoder().encode(decodeURIComponent(payload)),
    };
  } catch {
    throw new TypeError(`${field} must be a valid image data URL`);
  }
}

function assertBrandingSource(source: unknown, field: string): string {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  const protocol = protocolOf(source);
  if (protocol === undefined) {
    assertLocalPublicSource(source, field);
    return source;
  }
  if (protocol === "data") {
    parseDataImage(source, field);
    return source;
  }
  if (protocol !== "http" && protocol !== "https") {
    throw new TypeError(
      `${field} must be an http(s) URL, image data URL, or safe path relative to public/`
    );
  }
  try {
    new URL(source);
  } catch {
    throw new TypeError(`${field} must be a valid absolute http(s) URL`);
  }
  return source;
}

/**
 * Validate and freeze the branding fields from server configuration.
 *
 * @param config - Untyped-compatible branding input.
 * @returns Immutable normalized branding and the selected favicon MIME type.
 *
 * @internal
 */
export function normalizeServerBranding(config: {
  favicon?: unknown;
  icons?: unknown;
  websiteUrl?: unknown;
}): ServerBranding {
  let websiteUrl: string | undefined;
  if (config.websiteUrl !== undefined) {
    if (
      typeof config.websiteUrl !== "string" ||
      config.websiteUrl.length === 0
    ) {
      throw new TypeError(
        "websiteUrl must be a non-empty absolute http(s) URL"
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(config.websiteUrl);
    } catch {
      throw new TypeError(
        "websiteUrl must be a non-empty absolute http(s) URL"
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(
        "websiteUrl must be a non-empty absolute http(s) URL"
      );
    }
    websiteUrl = config.websiteUrl;
  }

  let icons: readonly Icon[] | undefined;
  if (config.icons !== undefined) {
    if (!Array.isArray(config.icons)) {
      throw new TypeError("icons must be an array of MCP Icon objects");
    }
    icons = Object.freeze(
      config.icons.map((value, index): Icon => {
        if (typeof value !== "object" || value === null) {
          throw new TypeError(`icons[${index}] must be an MCP Icon object`);
        }
        const icon = value as Record<string, unknown>;
        const src = assertBrandingSource(icon["src"], `icons[${index}].src`);
        const mimeType = icon["mimeType"];
        if (
          mimeType !== undefined &&
          (typeof mimeType !== "string" ||
            !mimeType.toLowerCase().startsWith("image/"))
        ) {
          throw new TypeError(
            `icons[${index}].mimeType must be an image MIME type when provided`
          );
        }
        const sizes = icon["sizes"];
        if (
          sizes !== undefined &&
          (!Array.isArray(sizes) ||
            sizes.some((size) => typeof size !== "string" || size.length === 0))
        ) {
          throw new TypeError(
            `icons[${index}].sizes must be an array of non-empty strings when provided`
          );
        }
        const normalizedSizes =
          sizes === undefined
            ? undefined
            : (sizes as unknown[]).map((size) => size as string);
        const theme = icon["theme"];
        if (theme !== undefined && theme !== "light" && theme !== "dark") {
          throw new TypeError(
            `icons[${index}].theme must be "light" or "dark" when provided`
          );
        }
        return Object.freeze({
          src,
          ...(mimeType !== undefined && { mimeType }),
          ...(normalizedSizes !== undefined && {
            sizes: Object.freeze(normalizedSizes) as string[],
          }),
          ...(theme !== undefined && { theme }),
        });
      })
    );
  }

  const explicitFavicon =
    config.favicon === undefined
      ? undefined
      : assertBrandingSource(config.favicon, "favicon");
  const inferred =
    explicitFavicon === undefined
      ? selectFaviconFromIcons(icons ?? [])
      : undefined;
  const favicon = explicitFavicon ?? inferred?.src;
  const faviconMimeType =
    inferred?.mimeType ??
    icons?.find((icon) => icon.src === explicitFavicon)?.mimeType;

  return Object.freeze({
    ...(favicon !== undefined && { favicon }),
    ...(faviconMimeType !== undefined && { faviconMimeType }),
    ...(icons !== undefined && { icons }),
    ...(websiteUrl !== undefined && { websiteUrl }),
  });
}

/**
 * Resolve configured icons for MCP implementation metadata.
 *
 * Absolute HTTP(S) and data URLs pass through. Public-relative sources become
 * request-scoped absolute URLs under `${basePath}/_mcp-use/public/`.
 *
 * @param icons - Normalized configured icons.
 * @param request - HTTP request used to derive the public asset origin.
 * @param basePath - MCP endpoint base path.
 * @returns Icons suitable for the official SDK `Implementation` object.
 *
 * @internal
 */
export function resolveImplementationIcons(
  icons: readonly Icon[] | undefined,
  request: Request | undefined,
  basePath: string
): Icon[] | undefined {
  if (icons === undefined) {
    return undefined;
  }
  return icons.map((icon) => ({
    ...icon,
    src:
      request !== undefined && isLocalPublicSource(icon.src)
        ? `${resolveAssetsBase(request)}${publicAssetPath(basePath, icon.src)}`
        : icon.src,
    ...(icon.sizes !== undefined && { sizes: [...icon.sizes] }),
  }));
}

/**
 * Whether any configured branding source needs the local public route.
 *
 * @param branding - Normalized branding to inspect.
 * @returns `true` when the favicon or an MCP icon uses a `public/` path.
 *
 * @internal
 */
export function hasLocalBrandingAsset(branding: ServerBranding): boolean {
  return (
    (branding.favicon !== undefined && isLocalPublicSource(branding.favicon)) ||
    branding.icons?.some((icon) => isLocalPublicSource(icon.src)) === true
  );
}

/**
 * Create the root-level `/favicon.ico` handler for normalized branding.
 *
 * Local public files and data URLs are streamed directly. Absolute HTTP(S)
 * sources receive a temporary redirect, avoiding server-side remote fetches.
 *
 * @param branding - Normalized server branding.
 * @param options - Public directory resolution mode.
 * @returns A GET/HEAD handler, or `undefined` when no favicon is configured.
 *
 * @internal
 */
export function createFaviconHandler(
  branding: ServerBranding,
  options: { dev: boolean; projectRoot: string; deferCors?: boolean }
): FetchHandler | undefined {
  const source = branding.favicon;
  if (source === undefined) {
    return undefined;
  }

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    if (new URL(request.url).pathname !== "/favicon.ico") {
      return new Response("Not Found", { status: 404 });
    }

    const protocol = protocolOf(source);
    if (protocol === "http" || protocol === "https") {
      return new Response(null, {
        status: 307,
        headers: {
          Location: source,
          "Cache-Control": FAVICON_REDIRECT_CACHE_CONTROL,
        },
      });
    }
    if (protocol === "data") {
      const data = parseDataImage(source, "favicon");
      return new Response(
        request.method === "HEAD" ? null : data.bytes.buffer,
        {
          status: 200,
          headers: {
            "Content-Type": branding.faviconMimeType ?? data.mimeType,
            "Cache-Control": FAVICON_CACHE_CONTROL,
            "X-Content-Type-Options": "nosniff",
          },
        }
      );
    }

    const { join } = await import("node:path");
    const publicRoot = options.dev
      ? join(options.projectRoot, "public")
      : join(options.projectRoot, ".mcp-use/build/views/public");
    const diskPath = await resolvePublicFilePath(publicRoot, source);
    if (diskPath === null) {
      return new Response("Not Found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const response = await servePublicFile(diskPath, {
      ...(options.deferCors === true && { deferCors: true }),
      ...(request.method === "HEAD" && { head: true }),
    });
    response.headers.set("Cache-Control", FAVICON_CACHE_CONTROL);
    response.headers.set("X-Content-Type-Options", "nosniff");
    if (branding.faviconMimeType !== undefined) {
      response.headers.set("Content-Type", branding.faviconMimeType);
    }
    return response;
  };
}
