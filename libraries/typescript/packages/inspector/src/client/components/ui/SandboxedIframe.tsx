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
  /** Callback when sandbox proxy is ready */
  onProxyReady?: () => void;
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
    sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox",
    csp,
    permissions,
    permissive,
    onProxyReady,
    onMessage,
    className,
    style,
    title = "Sandboxed Content",
  },
  ref
) {
  const outerRef = useRef<HTMLIFrameElement>(null);
  const [proxyReady, setProxyReady] = useState(false);

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

    // Priority 2: Local development - use same origin (localhost or 127.0.0.1)
    // Sandbox attributes provide sufficient isolation without cross-origin enforcement
    if (currentHost === "localhost" || currentHost === "127.0.0.1") {
      sandboxHost = currentHost; // Keep same origin
    } else {
      // Priority 3: Production - use convention: sandbox-{hostname}
      // e.g., inspector.mcp-use.com -> sandbox-inspector.mcp-use.com
      sandboxHost = `sandbox-${currentHost}`;
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
        outerRef.current?.contentWindow?.postMessage(data, sandboxProxyOrigin);
      },
      getIframeElement: () => outerRef.current,
    }),
    [sandboxProxyOrigin]
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Validate origin
      if (event.origin !== sandboxProxyOrigin && sandboxProxyOrigin !== "*") {
        return;
      }
      if (event.source !== outerRef.current?.contentWindow) return;

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

  // Send HTML to proxy when ready
  useEffect(() => {
    if (!proxyReady || !html || !outerRef.current?.contentWindow) return;

    console.log("[SandboxedIframe] Sending HTML to sandbox proxy");

    // Send HTML via JSON-RPC notification per SEP-1865
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
    sandboxProxyOrigin,
  ]);

  return (
    <iframe
      ref={outerRef}
      src={sandboxProxyUrl}
      className={className}
      style={style}
      title={title}
      sandbox={sandbox}
      allow="web-share"
    />
  );
});
