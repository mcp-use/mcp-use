/**
 * Component-level widget configuration
 *
 * Declares per-widget static config (CSP, permissions, rendering preferences)
 * that lives alongside the React component. This replaces the `widgetMetadata`
 * export pattern for inline JSX widgets.
 *
 * @example Zero config (most widgets)
 * ```tsx
 * export default function MyWidget({ data }: Props) {
 *   return <div>{data}</div>;
 * }
 * ```
 *
 * @example With .config static property
 * ```tsx
 * export default function WeatherWidget({ city }: Props) {
 *   return <div>{city}</div>;
 * }
 * WeatherWidget.config = {
 *   csp: { connectDomains: ["https://api.weather.com"] },
 *   prefersBorder: true,
 * } satisfies ComponentWidgetConfig;
 * ```
 *
 * @example With defineWidget wrapper
 * ```tsx
 * export default defineWidget(
 *   function WeatherWidget({ city }: Props) { return <div>{city}</div>; },
 *   { csp: { connectDomains: ["https://api.weather.com"] }, prefersBorder: true }
 * );
 * ```
 */

import type { ComponentType } from "react";

/**
 * Content Security Policy configuration for a widget component.
 *
 * Maps to protocol-specific CSP formats:
 * - MCP Apps (SEP-1865): camelCase fields in `_meta.ui.csp`
 * - Apps SDK (ChatGPT): snake_case fields in `openai/widgetCSP`
 */
export interface WidgetCSPConfig {
  /** Origins for fetch/XHR/WebSocket. Maps to CSP `connect-src`. */
  connectDomains?: string[];
  /** Origins for scripts/styles/images/fonts/media. Maps to CSP `img-src`, `script-src`, etc. */
  resourceDomains?: string[];
  /** Origins for nested iframes. Maps to CSP `frame-src`. */
  frameDomains?: string[];
  /** Allowed base URIs. Maps to CSP `base-uri`. */
  baseUriDomains?: string[];
  /** [Apps SDK] Domains for openExternal redirects + return links. */
  redirectDomains?: string[];
}

/**
 * Sandbox permissions requested by the widget (MCP Apps spec SEP-1865).
 *
 * Hosts MAY honor these by setting appropriate iframe `allow` attributes.
 * Widgets SHOULD NOT assume permissions are granted; use JS feature detection.
 */
export interface WidgetPermissions {
  /** Request camera access. Maps to Permission Policy `camera`. */
  camera?: Record<string, never>;
  /** Request microphone access. Maps to Permission Policy `microphone`. */
  microphone?: Record<string, never>;
  /** Request geolocation access. Maps to Permission Policy `geolocation`. */
  geolocation?: Record<string, never>;
  /** Request clipboard write access. Maps to Permission Policy `clipboard-write`. */
  clipboardWrite?: Record<string, never>;
  /** Allow future permission types. */
  [key: string]: Record<string, never> | undefined;
}

/**
 * Per-component widget configuration.
 *
 * Declares static metadata that is intrinsic to the widget component:
 * CSP, permissions, rendering preferences, and identity. These values
 * don't change between tool calls -- they describe the widget itself.
 *
 * Merge order: spec defaults <- component `.config` <- JSX `_` props
 */
export interface ComponentWidgetConfig {
  /** Content Security Policy. Server origin is auto-injected. */
  csp?: WidgetCSPConfig;

  /** Sandbox permissions requested by the widget (camera, mic, geo, clipboard). */
  permissions?: WidgetPermissions;

  /** Visual border + background preference. `true` = border, `false` = none, omit = host decides. */
  prefersBorder?: boolean;

  /** Auto-send `ui/notifications/size-changed` via ResizeObserver. Default `true`. */
  autoResize?: boolean;

  /** Dedicated sandbox origin. Host-dependent format (e.g., `"{hash}.claudemcpcontent.com"`). */
  domain?: string;

  /** Widget self-description. Reduces redundant text below widget in hosts like ChatGPT. */
  description?: string;

  /** Arbitrary additional metadata forwarded as-is to `_meta` on the resource. */
  [key: string]: unknown;
}

/**
 * Component with optional `.config` static property.
 *
 * @example
 * ```tsx
 * function MyWidget(props: Props) { return <div />; }
 * MyWidget.config = { prefersBorder: true };
 * ```
 */
export type WidgetComponent<P = any> = ComponentType<P> & {
  config?: ComponentWidgetConfig;
};

/**
 * Wrap a React component with widget configuration.
 *
 * Attaches the config as a static `.config` property on the component.
 * The build system reads this via SSR module loading to configure the
 * widget resource's CSP, permissions, and rendering preferences.
 *
 * @param component - The React component
 * @param config - Widget configuration (CSP, permissions, rendering)
 * @returns The same component with `.config` attached
 *
 * @example
 * ```tsx
 * import { defineWidget } from "mcp-use/react";
 *
 * export default defineWidget(
 *   function WeatherDashboard({ city, forecast }: Props) {
 *     return <div>...</div>;
 *   },
 *   {
 *     csp: { connectDomains: ["https://api.openweathermap.org"] },
 *     prefersBorder: true,
 *   }
 * );
 * ```
 */
export function defineWidget<P>(
  component: ComponentType<P>,
  config: ComponentWidgetConfig
): WidgetComponent<P> {
  const widgetComponent = component as WidgetComponent<P>;
  widgetComponent.config = config;
  return widgetComponent;
}
