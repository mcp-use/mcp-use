/**
 * SandboxedIframe - DRY Double-Iframe Sandbox Component
 *
 * Provides a secure double-iframe architecture for rendering untrusted HTML:
 * Host Page → Sandbox Proxy (different origin) → Guest UI
 *
 * The sandbox proxy:
 * 1. Runs in a different origin for security isolation
 * 2. Loads guest HTML via srcdoc when ready
 * 3. Forwards messages between host and guest (except sandbox-internal)
 *
 * Per SEP-1865, this component is designed to be reusable for MCP Apps
 * and potentially future OpenAI SDK consolidation.
 */

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
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
    camera?: boolean | object;
    microphone?: boolean | object;
    geolocation?: boolean | object;
    clipboardWrite?: boolean | object;
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

    let sandboxHost: string;
    if (currentHost === "localhost") {
      sandboxHost = "127.0.0.1";
    } else if (currentHost === "127.0.0.1") {
      sandboxHost = "localhost";
    } else {
      throw new Error(
        "[SandboxedIframe] SEP-1865 violation: Cannot use same-origin sandbox. " +
          "Configure a sandbox subdomain (e.g., sandbox.example.com) or different port."
      );
    }

    const portSuffix = currentPort ? `:${currentPort}` : "";
    return `${protocol}//${sandboxHost}${portSuffix}/inspector/api/sandbox-proxy?v=${Date.now()}`;
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
      if (event.origin !== sandboxProxyOrigin && sandboxProxyOrigin !== "*") {
        return;
      }
      if (event.source !== outerRef.current?.contentWindow) return;

      // Console log messages (not JSON-RPC) - forward directly
      if (event.data?.type === "iframe-console-log") {
        onMessage(event);
        return;
      }

      // CSP violation messages (not JSON-RPC) - forward directly
      if (event.data?.type === "mcp-apps:csp-violation") {
        onMessage(event);
        return;
      }

      const { jsonrpc, method } =
        (event.data as { jsonrpc?: string; method?: string }) || {};
      if (jsonrpc !== "2.0") return;

      if (method === "ui/notifications/sandbox-proxy-ready") {
        setProxyReady(true);
        onProxyReady?.();
        return;
      }

      if (method?.startsWith("ui/notifications/sandbox-")) {
        return;
      }

      onMessage(event);
    },
    [onMessage, onProxyReady, sandboxProxyOrigin]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Build allow attribute for outer iframe based on requested permissions
  const outerAllowAttribute = useMemo(() => {
    const allowList = ["local-network-access *", "midi *"];
    // Permissions can be boolean or {} (SDK quirk), both are truthy
    if (permissions?.camera) allowList.push("camera *");
    if (permissions?.microphone) allowList.push("microphone *");
    if (permissions?.geolocation) allowList.push("geolocation *");
    if (permissions?.clipboardWrite) allowList.push("clipboard-write *");
    return allowList.join("; ");
  }, [permissions]);

  // Send HTML, CSP, and permissions to sandbox when ready (SEP-1865)
  useEffect(() => {
    if (!proxyReady || !html) return;

    outerRef.current?.contentWindow?.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-resource-ready",
        params: { html, sandbox, csp, permissions, permissive },
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
      sandbox={sandbox}
      allow={outerAllowAttribute}
      title={title}
      className={className}
      style={style}
    />
  );
});
