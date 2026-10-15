/**
 * Request data for a CLI-discovered `landing.tsx`, read through hooks.
 *
 * `renderToString` is synchronous, so the CLI-generated renderer stores the
 * request's data in this module for the duration of one render instead of
 * passing it through props or a React context. This module must not import
 * React: the server never loads it, and the project's own React copy renders
 * the page.
 */

import { getInstallTargets, type InstallTargets } from "./install-targets.js";
import type {
  LandingPagePrompt,
  LandingPageResource,
  LandingPageTool,
} from "./landing.js";

/** Server identity and request-resolved URLs available to `landing.tsx`. */
export interface LandingServerInfo {
  /** Protocol-facing server name. */
  name: string;

  /** Optional human-readable server title. */
  title?: string;

  /** Server version reported to MCP clients. */
  version: string;

  /** Optional server description. */
  description?: string;

  /** Absolute URL of the MCP endpoint, resolved from the incoming request. */
  url: string;

  /** The server's configured website, when present. */
  websiteUrl?: string;

  /** Absolute URL of the server favicon, when branding configures one. */
  iconUrl?: string;

  /** MIME type of the favicon, when known. */
  iconType?: string;

  /** Absolute prefix for project `public/` files, including a configured CDN. */
  publicBaseUrl: string;
}

/**
 * Data serialized into the landing page for server rendering and hydration.
 *
 * `server` is always present. Each list is present only when the page reads
 * it through the matching hook.
 */
export interface LandingData {
  /** Server identity and request-resolved URLs. */
  server: LandingServerInfo;

  /** Registered tools, when the page reads them with {@link useToolList}. */
  tools?: readonly LandingPageTool[];

  /** Registered prompts, when the page reads them with {@link usePromptList}. */
  prompts?: readonly LandingPagePrompt[];

  /**
   * Registered static resources, when the page reads them with
   * {@link useResourceList}.
   */
  resources?: readonly LandingPageResource[];
}

/** Optional {@link LandingData} lists, each paired with one hook. */
export type LandingDataKey = "tools" | "prompts" | "resources";

let current: LandingData | undefined;

function readLandingData(hook: string): LandingData {
  if (current === undefined) {
    throw new Error(
      `${hook}() was called outside the landing page. Call it from a component rendered by landing.tsx.`
    );
  }
  return current;
}

function readLandingList<K extends LandingDataKey>(
  hook: string,
  key: K
): NonNullable<LandingData[K]> {
  const value = readLandingData(hook)[key];
  if (value === undefined) {
    throw new Error(
      `${hook}() has no data. Import it in a module under landing.tsx.`
    );
  }
  return value;
}

/**
 * Read the server identity and request-resolved URLs in `landing.tsx`.
 *
 * @returns The server's name, title, version, description, MCP endpoint URL,
 * public-asset prefix, website, and favicon.
 * @throws When called outside a component rendered by `landing.tsx`.
 *
 * @example
 * ```tsx
 * import { useServerInfo } from "mcp-use/landing";
 *
 * export default function Landing() {
 *   const { title, name, url } = useServerInfo();
 *   return <h1>{title ?? name}: {url}</h1>;
 * }
 * ```
 */
export function useServerInfo(): LandingServerInfo {
  return readLandingData("useServerInfo").server;
}

/**
 * Read every registered tool in `landing.tsx`.
 *
 * @returns Tool names, titles, and descriptions, in registration order.
 * @throws When called outside a component rendered by `landing.tsx`, or when
 * the page was rendered without tool data.
 *
 * @example
 * ```tsx
 * import { useToolList } from "mcp-use/landing";
 *
 * export function Tools() {
 *   return <ul>{useToolList().map((tool) => <li key={tool.name}>{tool.title ?? tool.name}</li>)}</ul>;
 * }
 * ```
 */
export function useToolList(): readonly LandingPageTool[] {
  return readLandingList("useToolList", "tools");
}

/**
 * Read every registered prompt in `landing.tsx`.
 *
 * @returns Prompt names, titles, and descriptions, in registration order.
 * @throws When called outside a component rendered by `landing.tsx`, or when
 * the page was rendered without prompt data.
 */
export function usePromptList(): readonly LandingPagePrompt[] {
  return readLandingList("usePromptList", "prompts");
}

/**
 * Read every registered static resource in `landing.tsx`.
 *
 * @returns Resource URIs, names, titles, and descriptions, in registration
 * order.
 * @throws When called outside a component rendered by `landing.tsx`, or when
 * the page was rendered without resource data.
 */
export function useResourceList(): readonly LandingPageResource[] {
  return readLandingList("useResourceList", "resources");
}

/**
 * Read the links and commands that add this server to MCP clients in
 * `landing.tsx`.
 *
 * Same as {@link getInstallTargets} with the server's `title` (falling back
 * to its protocol `name`) and request-resolved MCP endpoint `url`, so the
 * client entries match the ones the built-in landing page creates.
 *
 * @returns One install target per client, in display order.
 * @throws When called outside a component rendered by `landing.tsx`.
 *
 * @example
 * ```tsx
 * import { useInstallTargets } from "mcp-use/landing";
 *
 * export function Install() {
 *   const install = useInstallTargets();
 *   return <a href={install.cursor.deeplink}>Add to {install.cursor.label}</a>;
 * }
 * ```
 */
export function useInstallTargets(): InstallTargets {
  const { url, name, title } = readLandingData("useInstallTargets").server;
  return getInstallTargets({ url, name: title ?? name });
}

/**
 * Run a synchronous server render with `data` visible to the landing hooks,
 * then restore the previous data, also when the render throws.
 *
 * @param data - Landing data for this request.
 * @param render - Synchronous render, such as `renderToString`.
 * @returns The render's result.
 *
 * @internal
 */
export function __withLandingData<T>(data: LandingData, render: () => T): T {
  const previous = current;
  current = data;
  try {
    return render();
  } finally {
    current = previous;
  }
}

/**
 * Make `data` visible to the landing hooks until replaced, for hydration in
 * the browser.
 *
 * @param data - Landing data parsed from the server-rendered document.
 *
 * @internal
 */
export function __setLandingData(data: LandingData | undefined): void {
  current = data;
}
