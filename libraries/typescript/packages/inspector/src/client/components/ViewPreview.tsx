/**
 * ViewPreview — chromeless preview route for the screenshot CLI.
 *
 * Two modes:
 *
 *   - **Bundle mode** (used by `mcp-use screenshot`): the CLI pre-fetches the
 *     tool result and widget resource, then injects the data into the page as
 *     `globalThis.__mcpUsePreviewBundle` via CDP `Page.addScriptToEvaluateOnNewDocument`.
 *     The component renders inline data with no live MCP connection — the OAuth
 *     token never enters the browser.
 *
 *   - **Live mode** (interactive debugging): no bundle global; the component
 *     opens an MCP connection from the browser via `useMcpClient`, looks up the
 *     widget resource, and renders. Tokens (if any) are forwarded via the
 *     `?headers=<base64>` query param. Reached via
 *     `/inspector/preview/:view?props=<base64>&theme=...&server=...`.
 *
 * In both modes, `body[data-view-ready="true"]` is set once the renderer
 * signals readiness + fonts have loaded + two animation frames have elapsed.
 */

import { useMcpClient } from "mcp-use/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { MCPAppsRenderer } from "./MCPAppsRenderer";

const PREVIEW_SERVER_ID = "preview-default";
const PREVIEW_BUNDLE_SERVER_ID = "preview-bundle";

interface PreviewProps {
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
}

interface PreviewBundle {
  resourceUri: string;
  resourceContents: unknown;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
}

function decodeProps(raw: string | null): PreviewProps {
  if (!raw) return {};
  try {
    const json = atob(raw);
    const parsed = JSON.parse(json) as PreviewProps;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Fall through to empty
  }
  return {};
}

function findResourceUri(
  resources: { uri: string; name?: string }[],
  view: string
): string | undefined {
  // ui://widget/<view>.html or ui://widget/<view>.<buildId>.html.
  // Match by URI prefix; fall back to name match.
  const prefix = `ui://widget/${view}`;
  const byUri = resources.find(
    (r) => r.uri.startsWith(`${prefix}.`) && r.uri.endsWith(".html")
  );
  if (byUri) return byUri.uri;
  return resources.find((r) => r.name === view)?.uri;
}

function readPreviewBundle(): PreviewBundle | undefined {
  const g = (globalThis as { __mcpUsePreviewBundle?: unknown })
    .__mcpUsePreviewBundle;
  if (!g || typeof g !== "object") return undefined;
  const b = g as Partial<PreviewBundle>;
  if (typeof b.resourceUri !== "string") return undefined;
  return b as PreviewBundle;
}

/**
 * Apply the chromeless preview viewport (no scroll, no margins). Used by
 * both bundle and live modes.
 */
function usePreviewViewport(): void {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlMargin = html.style.margin;
    const prevBodyMargin = body.style.margin;
    const prevBodyOverflow = body.style.overflow;
    html.style.margin = "0";
    body.style.margin = "0";
    body.style.overflow = "hidden";
    return () => {
      html.style.margin = prevHtmlMargin;
      body.style.margin = prevBodyMargin;
      body.style.overflow = prevBodyOverflow;
    };
  }, []);
}

/**
 * Once the renderer signals readiness, wait for fonts.ready then two rAF
 * ticks and flip `body[data-view-ready="true"]` so the screenshot CLI's
 * polling selector matches.
 */
function usePreviewReadinessSignal(rendererReady: boolean): void {
  useEffect(() => {
    if (!rendererReady) return;
    let cancelled = false;
    (async () => {
      try {
        await document.fonts.ready;
      } catch {
        // fonts API may be unavailable; proceed anyway
      }
      if (cancelled) return;
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      if (cancelled) return;
      document.body.setAttribute("data-view-ready", "true");
    })();
    return () => {
      cancelled = true;
      document.body.removeAttribute("data-view-ready");
    };
  }, [rendererReady]);
}

/**
 * Bundle-mode readiness: after the renderer signals ready, watch the iframe's
 * bounding rect via ResizeObserver. Once the rect stops changing for a short
 * idle window (~250ms — enough to absorb the inline-height 300ms transition
 * and any post-layout settling), serialize the rect onto body data attributes
 * and flip `data-view-ready="true"` so the screenshot CLI can read it and
 * use it as the capture clip. Falls back gracefully if the iframe never
 * appears or never reports a size (the CLI's overall timeout still bounds us).
 */
function useBundleReadinessSignal(
  rendererReady: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    if (!rendererReady) return;
    let cancelled = false;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;

    const writeReady = (rect: DOMRect | null) => {
      if (cancelled) return;
      if (rect) {
        document.body.dataset.viewX = String(Math.round(rect.left));
        document.body.dataset.viewY = String(Math.round(rect.top));
        document.body.dataset.viewWidth = String(Math.round(rect.width));
        document.body.dataset.viewHeight = String(Math.round(rect.height));
      }
      document.body.setAttribute("data-view-ready", "true");
    };

    (async () => {
      try {
        await document.fonts.ready;
      } catch {
        // fonts API may be unavailable; proceed anyway
      }
      if (cancelled) return;
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      if (cancelled) return;

      const iframe = containerRef.current?.querySelector("iframe");
      if (!iframe) {
        writeReady(null);
        return;
      }

      const scheduleStable = () => {
        if (stableTimer) clearTimeout(stableTimer);
        stableTimer = setTimeout(() => {
          if (cancelled) return;
          observer?.disconnect();
          writeReady(iframe.getBoundingClientRect());
        }, 250);
      };

      observer = new ResizeObserver(scheduleStable);
      observer.observe(iframe);
      scheduleStable();
    })();

    return () => {
      cancelled = true;
      if (stableTimer) clearTimeout(stableTimer);
      observer?.disconnect();
      document.body.removeAttribute("data-view-ready");
      delete document.body.dataset.viewX;
      delete document.body.dataset.viewY;
      delete document.body.dataset.viewWidth;
      delete document.body.dataset.viewHeight;
    };
  }, [rendererReady, containerRef]);
}

/**
 * Bundle mode: render from inline data injected by the screenshot CLI.
 * No live MCP connection. Runtime widget calls (`oncalltool`,
 * `onlistresources`) intentionally fall through to MCPAppsRenderer's
 * "no server" path and throw — bundle mode targets initial render only.
 *
 * Uses `displayMode="inline"` so the iframe auto-sizes to the widget's
 * reported height (avoiding the whitespace that fullscreen mode produces
 * for widgets shorter than the viewport). An optional `?width=N` query
 * param overrides the inline 768px max-width cap so callers can request
 * wider screenshots.
 */
function ViewPreviewBundle({
  view,
  bundle,
  widthOverride,
}: {
  view: string;
  bundle: PreviewBundle;
  widthOverride?: number;
}) {
  const [rendererReady, setRendererReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  usePreviewViewport();
  useBundleReadinessSignal(rendererReady, containerRef);

  const readResource = useMemo(() => {
    return async (uri: string) => {
      if (uri === bundle.resourceUri) return bundle.resourceContents;
      throw new Error(`Resource ${uri} not in screenshot bundle`);
    };
  }, [bundle]);

  const toolCallId = useMemo(
    () => `preview-bundle-${view}-${Date.now().toString(36)}`,
    [view]
  );

  return (
    <div ref={containerRef} style={{ width: "100vw", height: "100vh" }}>
      <MCPAppsRenderer
        serverId={PREVIEW_BUNDLE_SERVER_ID}
        toolCallId={toolCallId}
        toolName={view}
        toolInput={bundle.toolInput}
        toolOutput={bundle.toolOutput}
        resourceUri={bundle.resourceUri}
        readResource={readResource}
        displayMode="inline"
        inlineWidthOverride={widthOverride}
        noWrapper
        chromeless
        onReady={() => setRendererReady(true)}
      />
    </div>
  );
}

/**
 * Live mode: open an MCP connection in the browser and render against it.
 * Used for interactive debugging via `/inspector/preview/:view?...`.
 */
function ViewPreviewLive({ view }: { view: string }) {
  const [search] = useSearchParams();

  const previewProps = useMemo(
    () => decodeProps(search.get("props")),
    [search]
  );

  const serverUrl = useMemo(() => {
    const fromQuery = search.get("server");
    if (fromQuery) return fromQuery;
    return `${window.location.origin}/mcp`;
  }, [search]);

  // Forwarded headers for live-mode interactive use. Not used by the
  // screenshot CLI anymore — that path uses bundle mode.
  const previewHeaders = useMemo(() => {
    const raw = search.get("headers");
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(atob(raw));
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, string>;
      }
    } catch {
      // Fall through.
    }
    return undefined;
  }, [search]);

  const { servers, addServer, storageLoaded } = useMcpClient();
  const server = servers.find((s) => s.id === PREVIEW_SERVER_ID);

  useEffect(() => {
    if (!storageLoaded) return;
    addServer(PREVIEW_SERVER_ID, {
      url: serverUrl,
      name: "Preview",
      ...(previewHeaders ? { headers: previewHeaders } : {}),
    });
  }, [storageLoaded, serverUrl, previewHeaders, addServer]);

  const ready = server?.state === "ready";
  const failed = server?.state === "failed";

  const resourceUri = useMemo(() => {
    if (!ready) return undefined;
    return findResourceUri(server.resources, view);
  }, [ready, server?.resources, view]);

  const toolCallId = useMemo(
    () => `preview-${view}-${Date.now().toString(36)}`,
    [view]
  );

  const readResource = useMemo(() => {
    return async (uri: string) => {
      if (!server?.readResource) {
        throw new Error("Server not ready");
      }
      return server.readResource(uri);
    };
  }, [server]);

  const [rendererReady, setRendererReady] = useState(false);
  usePreviewReadinessSignal(rendererReady);
  usePreviewViewport();

  if (failed) {
    return (
      <div style={{ padding: 16, fontFamily: "monospace", color: "#b00" }}>
        Failed to connect to MCP server at {serverUrl}.
      </div>
    );
  }

  if (!ready || !resourceUri) {
    if (ready && !resourceUri) {
      return (
        <div style={{ padding: 16, fontFamily: "monospace", color: "#b00" }}>
          View "{view}" not found on {serverUrl}.
        </div>
      );
    }
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          color: "var(--muted-foreground, #888)",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <MCPAppsRenderer
        serverId={PREVIEW_SERVER_ID}
        toolCallId={toolCallId}
        toolName={view}
        toolInput={previewProps.toolInput}
        toolOutput={previewProps.toolOutput}
        resourceUri={resourceUri}
        readResource={readResource}
        displayMode="fullscreen"
        noWrapper
        chromeless
        onReady={() => setRendererReady(true)}
      />
    </div>
  );
}

export function ViewPreview() {
  const params = useParams<{ view: string }>();
  const [search] = useSearchParams();
  const view = params.view ?? "";

  // Bundle is read once at mount. The screenshot CLI sets it via CDP
  // before any document scripts run, so it's stable across renders.
  const bundle = useMemo(() => readPreviewBundle(), []);

  const widthOverride = useMemo(() => {
    const raw = search.get("width");
    if (!raw) return undefined;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [search]);

  if (bundle) {
    return (
      <ViewPreviewBundle
        view={view}
        bundle={bundle}
        widthOverride={widthOverride}
      />
    );
  }
  return <ViewPreviewLive view={view} />;
}
