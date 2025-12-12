/**
 * Console log interceptor script to be injected into iframes
 * Captures console.log, console.error, console.warn, console.info, console.debug
 * and forwards them to the parent window via postMessage
 */
export const IFRAME_CONSOLE_INTERCEPTOR_SCRIPT = `
(function() {
  'use strict';

  // Only intercept if we're in an iframe
  if (window.self === window.top) {
    return;
  }

  // Store original console methods
  const originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    trace: console.trace.bind(console),
  };

  // Helper to serialize arguments for postMessage
  function serializeArgs(args) {
    try {
      return Array.from(args).map(arg => {
        if (arg instanceof Error) {
          return {
            type: 'Error',
            message: arg.message,
            stack: arg.stack,
            name: arg.name,
          };
        }
        if (typeof arg === 'object' && arg !== null) {
          try {
            // Try to serialize, but handle circular references
            return JSON.parse(JSON.stringify(arg));
          } catch (e) {
            return String(arg);
          }
        }
        return arg;
      });
    } catch (e) {
      return [String(args)];
    }
  }

  // Helper to send log to parent
  function sendToParent(level, args) {
    try {
      window.parent.postMessage({
        type: 'iframe-console-log',
        level: level,
        args: serializeArgs(args),
        timestamp: new Date().toISOString(),
        url: window.location.href,
      }, '*');
    } catch (e) {
      // Fallback to original console if postMessage fails
      originalConsole.error('[Console Interceptor] Failed to send log:', e);
    }
  }

  // Override console methods
  console.log = function(...args) {
    originalConsole.log.apply(console, args);
    sendToParent('log', args);
  };

  console.error = function(...args) {
    originalConsole.error.apply(console, args);
    sendToParent('error', args);
  };

  console.warn = function(...args) {
    originalConsole.warn.apply(console, args);
    sendToParent('warn', args);
  };

  console.info = function(...args) {
    originalConsole.info.apply(console, args);
    sendToParent('info', args);
  };

  console.debug = function(...args) {
    originalConsole.debug.apply(console, args);
    sendToParent('debug', args);
  };

  console.trace = function(...args) {
    originalConsole.trace.apply(console, args);
    sendToParent('trace', args);
  };

  // Also capture unhandled errors
  window.addEventListener('error', function(event) {
    sendToParent('error', [{
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error ? {
        message: event.error.message,
        stack: event.error.stack,
        name: event.error.name,
      } : null,
    }]);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(event) {
    sendToParent('error', [{
      message: 'Unhandled Promise Rejection',
      reason: event.reason ? String(event.reason) : 'Unknown',
      error: event.reason instanceof Error ? {
        message: event.reason.message,
        stack: event.reason.stack,
        name: event.reason.name,
      } : null,
    }]);
  });
})();
`;

/**
 * Injects the console interceptor script into an iframe
 * Works for same-origin iframes. For cross-origin iframes, logs cannot be intercepted.
 */
export function injectConsoleInterceptor(iframe: HTMLIFrameElement): void {
  if (!iframe.contentWindow) {
    return;
  }

  const injectScript = () => {
    try {
      const iframeDoc = iframe.contentWindow?.document;
      if (!iframeDoc) {
        return;
      }

      // Check if already injected
      if (iframeDoc.querySelector("script[data-console-interceptor]")) {
        return;
      }

      const script = iframeDoc.createElement("script");
      script.setAttribute("data-console-interceptor", "true");
      script.textContent = IFRAME_CONSOLE_INTERCEPTOR_SCRIPT;

      // Inject at the beginning of the head or body
      const target =
        iframeDoc.head || iframeDoc.body || iframeDoc.documentElement;
      if (target) {
        target.insertBefore(script, target.firstChild);
      }
    } catch (error) {
      // Cross-origin restrictions - cannot inject script
      // This is expected for cross-origin iframes and is not an error
      if (error instanceof Error && error.name !== "SecurityError") {
        console.warn(
          "[IframeConsole] Failed to inject console interceptor:",
          error
        );
      }
    }
  };

  try {
    // Try to inject immediately if document is ready
    const iframeDoc = iframe.contentDocument;
    if (
      iframeDoc?.readyState === "complete" ||
      iframeDoc?.readyState === "interactive"
    ) {
      injectScript();
    } else {
      // Wait for load event
      const handleLoad = () => {
        injectScript();
        iframe.removeEventListener("load", handleLoad);
      };
      iframe.addEventListener("load", handleLoad, { once: true });

      // Also try after a short delay in case load event already fired
      setTimeout(() => {
        try {
          if (
            iframe.contentDocument?.readyState === "complete" ||
            iframe.contentDocument?.readyState === "interactive"
          ) {
            injectScript();
          }
        } catch {
          // Ignore errors
        }
      }, 100);
    }
  } catch (error) {
    // Cross-origin iframe - cannot access contentDocument
    // This is expected and not an error
  }
}
