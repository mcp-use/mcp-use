import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import React, { useLayoutEffect, useState } from "react";

import { useHostContextSubscription } from "../runtime/view-runtime-context.js";

/** Keep iframe canvas transparent so host background shows through rounded views. */
function applyTransparentIframeCanvas(): void {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  const root = document.getElementById("root");
  if (root) root.style.background = "transparent";
}

const FILL_HOST_WRAPPER_STYLE: React.CSSProperties = {
  position: "relative",
  height: "100%",
  minHeight: "100%",
  display: "flex",
  flexDirection: "column",
};

/** ponytail: inline widgets size to content; fullscreen/pip need a height chain */
function useFillHostDocument(fillHost: boolean): void {
  useLayoutEffect(() => {
    if (!fillHost || typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const prev = {
      htmlH: html.style.height,
      bodyH: body.style.height,
      htmlMin: html.style.minHeight,
      bodyMin: body.style.minHeight,
      rootH: root?.style.height ?? "",
      rootMin: root?.style.minHeight ?? "",
    };

    for (const el of [html, body]) {
      el.style.height = "100%";
      el.style.minHeight = "100%";
    }
    if (root) {
      root.style.height = "100%";
      root.style.minHeight = "100%";
    }

    return () => {
      html.style.height = prev.htmlH;
      body.style.height = prev.bodyH;
      html.style.minHeight = prev.htmlMin;
      body.style.minHeight = prev.bodyMin;
      if (root) {
        root.style.height = prev.rootH;
        root.style.minHeight = prev.rootMin;
      }
    };
  }, [fillHost]);
}

/**
 * Applies host theme, style variables, and fonts to the document root.
 *
 * Subscribes to the runtime's host-context channel for theme,
 * `styles.variables`, and `styles.css.fonts`. Theme-only consumers should use
 * {@link useViewTheme} so locale and dimension updates do not rerender them.
 *
 * MCP App views render in srcdoc iframes; the document canvas stays transparent
 * by default so rounded cards do not expose an opaque `color-scheme` backdrop.
 */
export const ThemeProvider: React.FC<{
  /** View subtree that receives the host theme. */
  children: React.ReactNode;
  /** Set `color-scheme` on the document root to match the active theme. */
  colorScheme?: boolean;
}> = ({ children, colorScheme = false }) => {
  const hostContext = useHostContextSubscription();
  const [systemPreference, setSystemPreference] = useState<"light" | "dark">(
    () => {
      if (typeof window === "undefined") return "light";
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPreference(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const hostTheme =
    hostContext?.theme === "dark" || hostContext?.theme === "light"
      ? hostContext.theme
      : undefined;
  const effectiveTheme = hostTheme ?? systemPreference;
  const fillHost =
    hostContext?.displayMode === "fullscreen" ||
    hostContext?.displayMode === "pip";

  useFillHostDocument(fillHost);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    applyDocumentTheme(effectiveTheme);
    applyTransparentIframeCanvas();
    if (colorScheme) {
      document.documentElement.style.colorScheme =
        effectiveTheme === "dark" ? "dark" : "light";
    } else {
      document.documentElement.style.colorScheme = "";
    }
  }, [effectiveTheme, colorScheme]);

  useLayoutEffect(() => {
    const variables = hostContext?.styles?.variables;
    if (variables) {
      applyHostStyleVariables(variables);
    }
    const fonts = hostContext?.styles?.css?.fonts;
    if (typeof fonts === "string") {
      applyHostFonts(fonts);
    }
  }, [hostContext]);

  if (fillHost) {
    return <div style={FILL_HOST_WRAPPER_STYLE}>{children}</div>;
  }

  return <>{children}</>;
};
