/**
 * Inline Widget Entry Wrapper Generator
 *
 * Generates the bridge entry files that connect a plain React component
 * to the MCP widget protocol. The entry wrapper:
 * - Imports the user's component
 * - Uses useWidget() to get structuredContent, toolInput, and theme
 * - Uses useStreamableProps() to receive incremental prop updates
 * - Spreads everything as typed props to the component
 * - Mounts into the #widget-root div
 */

import type { InlineWidgetManifestEntry } from "./inline-widget-middleware.js";

/**
 * Generate the entry.tsx source for an inline widget.
 *
 * @param entry - Manifest entry for the widget
 * @param relativeComponentPath - Relative path from the entry file to the component
 * @returns Source code for the entry.tsx file
 */
export function generateEntrySource(
  entry: InlineWidgetManifestEntry,
  relativeComponentPath: string
): string {
  const componentImportPath = relativeComponentPath.replace(/\\/g, "/");

  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import { useWidget, useStreamableProps } from 'mcp-use/react';
import './styles.css';
import Component from '${componentImportPath}';

function Wrapper() {
  const { props, toolInput, isPending } = useWidget();
  const mergedProps = useStreamableProps(props);

  if (isPending) {
    return null;
  }

  return <Component {...mergedProps} toolInput={toolInput} />;
}

const container = document.getElementById('widget-root');
if (container && Component) {
  let root = (container as any).__mcpRoot;
  if (!root) {
    root = createRoot(container);
    (container as any).__mcpRoot = root;
  }
  root.render(<Wrapper />);

  setTimeout(() => {
    window.parent.postMessage({ type: 'mcp-inspector:widget:ready' }, '*');
  }, 100);
}
`;
}

/**
 * Generate the index.html shell for an inline widget (dev mode).
 *
 * @param widgetName - Slugified widget name
 * @param baseUrl - Full base URL for Vite assets
 * @param favicon - Optional favicon path
 * @returns HTML content for the widget shell
 */
export function generateHtmlShell(
  widgetName: string,
  baseUrl: string,
  favicon?: string
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${widgetName} Widget</title>${
      favicon
        ? `\n    <link rel="icon" href="${baseUrl.replace(/\/$/, "")}/mcp-use/public/${favicon}" />`
        : ""
    }
    <script type="module" src="${baseUrl}/@vite/client"></script>
    <script type="module">
      import RefreshRuntime from '${baseUrl}/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
  </head>
  <body>
    <div id="widget-root"></div>
    <script type="module" src="${baseUrl}/${widgetName}/entry.tsx"></script>
  </body>
</html>`;
}

/**
 * Generate Tailwind CSS content for an inline widget.
 *
 * @param relativeComponentDir - Relative path from entry dir to the component's directory
 * @param relativeMcpUsePath - Relative path from entry dir to node_modules/mcp-use
 * @returns CSS content with Tailwind directives and @source paths
 */
export function generateStylesSource(
  relativeComponentDir: string,
  relativeMcpUsePath: string
): string {
  const componentDir = relativeComponentDir.replace(/\\/g, "/");
  const mcpUsePath = relativeMcpUsePath.replace(/\\/g, "/");

  return `@import "tailwindcss";

/* Configure Tailwind to scan the component directory and mcp-use package */
@source "${componentDir}";
@source "${mcpUsePath}/**/*.{ts,tsx,js,jsx}";
`;
}

/**
 * Data needed to create widget temp files.
 */
export interface InlineWidgetTempFiles {
  entryTsx: string;
  indexHtml: string;
  stylesCss: string;
}

/**
 * Generate all temp files for an inline widget.
 *
 * @param entry - Manifest entry
 * @param relativeComponentPath - Relative path from temp dir to component
 * @param relativeComponentDir - Relative path from temp dir to component's directory
 * @param relativeMcpUsePath - Relative path from temp dir to node_modules/mcp-use
 * @param baseUrl - Vite base URL for dev server assets
 * @param favicon - Optional favicon path
 * @returns Object with all generated file contents
 */
export function generateInlineWidgetFiles(
  entry: InlineWidgetManifestEntry,
  relativeComponentPath: string,
  relativeComponentDir: string,
  relativeMcpUsePath: string,
  baseUrl: string,
  favicon?: string
): InlineWidgetTempFiles {
  return {
    entryTsx: generateEntrySource(entry, relativeComponentPath),
    indexHtml: generateHtmlShell(entry.widgetName, baseUrl, favicon),
    stylesCss: generateStylesSource(relativeComponentDir, relativeMcpUsePath),
  };
}
