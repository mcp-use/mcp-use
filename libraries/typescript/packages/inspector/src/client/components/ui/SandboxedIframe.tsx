/**
 * SandboxedIframe - Double-Iframe Sandbox Component for MCP Apps
 *
 * Provides secure double-iframe architecture for rendering untrusted HTML:
 * Host Page → Sandbox Proxy (different origin) → Guest UI
 *
 * The sandbox proxy:
 * 1. Runs on a different origin for security isolation (localhost ↔ 127.0.0.1)
 * 2. Loads guest HTML via srcdoc when ready
 * 3. Forwards messages between host and guest (except sandbox-internal)
 *
 * Per SEP-1865, this component provides cross-origin isolation for MCP Apps.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { IFRAME_SANDBOX_PERMISSIONS, PROXY_IFRAME_SANDBOX } from "../../constants/iframe";

export interface SandboxedIframeHandle {
  postMessage: (data: unknown) => void;
  getIframeElement: () => HTMLIFrameElement | null;
}

interface SandboxedIframeProps {
  /** HTML content to render in the sandbox */
  html: string | null;
  /** Sandbox attribute for the inner iframe */
  sandbox?: string;
  /** CSP metadata from resource _meta.ui.csp (SEP-1865) */
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  };
  /** Permissions metadata from resource _meta.ui.permissions (SEP-1865) */
  permissions?: {
    camera?: object;
    microphone?: object;
    geolocation?: object;
    clipboardWrite?: object;
  };
  /** Skip CSP injection entirely (for permissive/testing mode) */
  permissive?: boolean;
  /** Legacy query string exposed to srcdoc widgets for mcpUseParams compatibility */
  legacyLocationSearch?: string;
  /** JSON object injected directly as window.mcpUseProps for easier widget access */
  mcpUseProps?: any;
  /** Callback when sandbox proxy is ready */
  onProxyReady?: () => void;
  /** Callback when the outer iframe has loaded */
  onLoad?: () => void;
  /** Fired once when this sandbox instance mounts (used to detect remounts). */
  onSandboxMount?: () => void;
  /** Callback for messages from guest UI (excluding sandbox-internal messages) */
  onMessage: (event: MessageEvent) => void;
  /** CSS class for the outer iframe */
  className?: string;
  /** Inline styles for the outer iframe */
  style?: React.CSSProperties;
  /** Title for accessibility */
  title?: string;
}

/**
 * SandboxedIframe provides a secure double-iframe architecture per SEP-1865.
 *
 * Message flow:
 * 1. Proxy sends ui/notifications/sandbox-proxy-ready when loaded
 * 2. Host sends ui/notifications/sandbox-resource-ready with HTML
 * 3. Guest UI initializes and communicates via JSON-RPC 2.0
 */
export const SandboxedIframe = forwardRef<
  SandboxedIframeHandle,
  SandboxedIframeProps
>(function SandboxedIframe(
  {
    html,
    sandbox = IFRAME_SANDBOX_PERMISSIONS,
    csp,
    permissions,
    permissive,
    legacyLocationSearch,
    mcpUseProps,
    onProxyReady,
    onLoad,
    onSandboxMount,
    onMessage,
    className,
    style,
    title = "Sandboxed Content",
  },
  ref
) {
  const outerRef = useRef<HTMLIFrameElement>(null);
  const [proxyReady, setProxyReady] = useState(false);

  useEffect(() => {
    onSandboxMount?.();
  }, [onSandboxMount]);

  // SEP-1865: Host and Sandbox MUST have different origins
  const [sandboxProxyUrl] = useState(() => {
    const currentHost = window.location.hostname;
    const currentPort = window.location.port;
    const protocol = window.location.protocol;

    // Priority 1: Check for configured sandbox origin (injected at build time or runtime)
    const configuredSandboxOrigin = (window as any).__MCP_SANDBOX_ORIGIN__;
    if (configuredSandboxOrigin) {
      // Use fully configured origin (e.g., "https://sandbox-inspector.mcp-use.com")
      return `${configuredSandboxOrigin}/inspector/api/mcp-apps/sandbox-proxy?v=${Date.now()}`;
    }

    let sandboxHost: string;

    // Priority 2: Local development or dev mode - use same origin
    // In dev mode (mcp-use dev) or localhost, sandbox attributes provide sufficient
    // isolation without requiring a separate sandbox-{hostname} subdomain.
    // This enables MCP Apps widgets to work behind reverse proxies (ngrok, E2B)
    // where the sandbox-{hostname} subdomain doesn't exist.
    const isDevMode = (window as any).__MCP_DEV_MODE__ === true;
    if (
      currentHost === "localhost" ||
      currentHost === "127.0.0.1" ||
      isDevMode
    ) {
      sandboxHost = currentHost; // Keep same origin
    } else {
      // Priority 3: Production - preserve the inspector namespace when deriving
      // the sandbox host. Cloud embeds run on apex hosts such as manufact.com,
      // while direct inspector pages run on inspector.{domain}; both should
      // resolve to sandbox-inspector.{domain}.
      if (currentHost.startsWith("dev.")) {
        const rest = currentHost.slice(4); // "dev.".length
        sandboxHost = `sandbox-inspector.dev.${rest}`;
      } else if (currentHost.startsWith("inspector.")) {
        sandboxHost = `sandbox-${currentHost}`;
      } else {
        sandboxHost = `sandbox-inspector.${currentHost}`;
      }
    }

    const portSuffix = currentPort ? `:${currentPort}` : "";
    return `${protocol}//${sandboxHost}${portSuffix}/inspector/api/mcp-apps/sandbox-proxy?v=${Date.now()}`;
  });

  const sandboxProxyOrigin = useMemo(() => {
    try {
      return new URL(sandboxProxyUrl).origin;
    } catch {
      return "*";
    }
  }, [sandboxProxyUrl]);

  useImperativeHandle(
    ref,
    () => ({
      postMessage: (data: unknown) => {
        // We now use strict origin targeting since the proxy has allow-same-origin
        // and maintains its true network origin.
        outerRef.current?.contentWindow?.postMessage(data, sandboxProxyOrigin);
      },
      getIframeElement: () => outerRef.current,
    }),
    [sandboxProxyOrigin]
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Validate source first — this is the real security check.
      // We don't rely solely on origin because a sandboxed iframe without
      // allow-same-origin gets an opaque origin (reported as the string "null"),
      // not the URL origin. Accept both the expected origin and "null".
      if (event.source !== outerRef.current?.contentWindow) return;
      if (
        event.origin !== sandboxProxyOrigin &&
        event.origin !== "null" &&
        sandboxProxyOrigin !== "*"
      ) {
        return;
      }

      // Handle sandbox-specific messages
      if (
        event.data?.method === "ui/notifications/sandbox-proxy-ready" ||
        event.data?.type === "sandbox-proxy-ready"
      ) {
        console.log("[SandboxedIframe] Sandbox proxy ready");
        setProxyReady(true);
        onProxyReady?.();
        return;
      }

      // Forward all other messages to parent handler
      onMessage(event);
    },
    [sandboxProxyOrigin, onProxyReady, onMessage]
  );

  // Listen for messages from proxy
  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Handshake retry: if the proxy fires sandbox-proxy-ready before React
  // attaches the message listener (race condition on fast loads), proxyReady
  // never becomes true. After the iframe loads, poll every 150 ms for up to
  // 3 seconds and send a ping to the proxy so it re-announces itself.
  const proxyReadyRef = useRef(proxyReady);
  proxyReadyRef.current = proxyReady;
  const handleLoad = useCallback(
    (iframeWin: Window | null | undefined) => {
      if (!iframeWin) return;
      let attempts = 0;
      const maxAttempts = 20; // 20 × 150 ms = 3 s
      const interval = setInterval(() => {
        if (proxyReadyRef.current || attempts >= maxAttempts) {
          clearInterval(interval);
          return;
        }
        attempts++;
        // Send a harmless ping so the proxy sees a message from the parent
        // and re-announces sandbox-proxy-ready (see sandbox-proxy.html).
        iframeWin.postMessage(
          { jsonrpc: "2.0", method: "ui/ping", params: {} },
          "*"
        );
      }, 150);
      return () => clearInterval(interval);
    },
    []
  );

  // Send HTML to proxy when ready
  // CAUTION: Each run causes proxy to set inner.srcdoc = html, fully reloading the widget
  useEffect(() => {
    if (!proxyReady || !html || !outerRef.current?.contentWindow) return;

    // Send HTML via JSON-RPC notification per SEP-1865.
    // Target "*" because proxy may have opaque origin (sandboxed without allow-same-origin).
    outerRef.current.contentWindow.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-resource-ready",
        params: {
          html,
          sandbox,
          csp,
          permissions,
          permissive,
          legacyLocationSearch,
          mcpUseProps,
        },
      },
      sandboxProxyOrigin
    );
  }, [
    proxyReady,
    html,
    sandbox,
    csp,
    permissions,
    permissive,
    legacyLocationSearch,
    mcpUseProps,
    sandboxProxyOrigin,
  ]);

  return (
    <iframe
      ref={outerRef}
      src={sandboxProxyUrl}
      className={className}
      style={style}
      title={title}
      sandbox={PROXY_IFRAME_SANDBOX}
      allow="web-share"
      onLoad={(e) => {
        onLoad?.();
        handleLoad(
          (e.currentTarget as HTMLIFrameElement).contentWindow ?? undefined
        );
      }}
    />
  );
});
