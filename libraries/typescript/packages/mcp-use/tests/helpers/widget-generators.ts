/**
 * Test Helper Utilities for Widget Generation
 *
 * These functions generate HTML and JavaScript content for testing purposes.
 * They are not part of the core UIResource creation flow.
 */

import type { UIResourceDefinition } from 'mcp-use/server'

/**
 * Generate HTML content for a widget (utility function for tests)
 *
 * @param definition - Base UI resource definition
 * @param props - Widget properties to inject
 * @returns Generated HTML string
 */
export function generateWidgetHtml(
  definition: Pick<UIResourceDefinition, 'name' | 'title' | 'description' | 'size'>,
  props?: Record<string, any>
): string {
  const [width = '100%', height = '400px'] = definition.size || []
  const propsJson = props ? JSON.stringify(props) : '{}'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${definition.title || definition.name}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .widget-container {
      width: ${width};
      height: ${height};
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      overflow: auto;
      padding: 20px;
      background: white;
    }
    .widget-title {
      font-size: 1.5em;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .widget-description {
      color: #666;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="widget-container">
    <div class="widget-title">${definition.title || definition.name}</div>
    ${definition.description ? `<div class="widget-description">${definition.description}</div>` : ''}
    <div id="widget-root"></div>
  </div>
  <script>
    // Widget props passed from server
    window.__WIDGET_PROPS__ = ${propsJson};

    // Placeholder for widget initialization
    console.log('Widget ${definition.name} loaded with props:', window.__WIDGET_PROPS__);

    // Communication with parent window
    window.addEventListener('message', (event) => {
      console.log('Received message:', event.data);
    });

    // Example tool call
    function callTool(toolName, params) {
      window.parent.postMessage({
        type: 'tool',
        payload: { toolName, params }
      }, '*');
    }
  </script>
</body>
</html>`
}

/**
 * Generate a Remote DOM script for a widget (utility function for tests)
 *
 * @param definition - Base UI resource definition
 * @param props - Widget properties to inject
 * @returns Generated JavaScript string
 */
export function generateRemoteDomScript(
  definition: Pick<UIResourceDefinition, 'name' | 'title' | 'description'>,
  props?: Record<string, any>
): string {
  return `
// Remote DOM script for ${definition.name}
const container = document.createElement('div');
container.style.padding = '20px';

// Create title
const title = document.createElement('h2');
title.textContent = '${definition.title || definition.name}';
container.appendChild(title);

${definition.description ? `
// Add description
const description = document.createElement('p');
description.textContent = '${definition.description}';
description.style.color = '#666';
container.appendChild(description);
` : ''}

// Widget props
const props = ${JSON.stringify(props || {})};

// Create interactive button
const button = document.createElement('ui-button');
button.setAttribute('label', 'Interact with ${definition.name}');
button.addEventListener('press', () => {
  window.parent.postMessage({
    type: 'tool',
    payload: {
      toolName: 'ui_${definition.name}',
      params: props
    }
  }, '*');
});
container.appendChild(button);

// Add custom widget logic here
console.log('Remote DOM widget ${definition.name} initialized with props:', props);

// Append to root
root.appendChild(container);`
}

