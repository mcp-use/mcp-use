import type { AppsSdkUIResource } from 'mcp-use/server'

/**
 * ════════════════════════════════════════════════════════════════════
 * Pizzaz Widget Definitions
 * ════════════════════════════════════════════════════════════════════
 * 
 * OpenAI's pizzaz reference implementation demonstrating Apps SDK widgets.
 * These widgets load external assets from OpenAI's CDN and use the
 * text/html+skybridge MIME type for Apps SDK compatibility.
 * 
 * Each widget demonstrates:
 * - External resource loading (scripts and stylesheets)
 * - Apps SDK metadata (CSP, tool invocation status, etc.)
 * - Structured content injection via window.openai.toolOutput
 */

export interface PizzazWidgetDefinition {
  id: string
  title: string
  description: string
  templateUri: string
  invoking: string
  invoked: string
  html: string
  responseText: string
}

export const pizzazWidgets: PizzazWidgetDefinition[] = [
  {
    id: 'pizza-map',
    title: 'Show Pizza Map',
    description: 'Interactive map widget for displaying pizza locations',
    templateUri: 'ui://widget/pizza-map.html',
    invoking: 'Hand-tossing a map',
    invoked: 'Served a fresh map',
    html: `
<div id="pizzaz-root"></div>
<link rel="stylesheet" href="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-0038.css">
<script type="module" src="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-0038.js"></script>
    `.trim(),
    responseText: 'Rendered a pizza map!'
  },
  {
    id: 'pizza-carousel',
    title: 'Show Pizza Carousel',
    description: 'Carousel widget for browsing pizza options',
    templateUri: 'ui://widget/pizza-carousel.html',
    invoking: 'Carousel some spots',
    invoked: 'Served a fresh carousel',
    html: `
<div id="pizzaz-carousel-root"></div>
<link rel="stylesheet" href="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-carousel-0038.css">
<script type="module" src="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-carousel-0038.js"></script>
    `.trim(),
    responseText: 'Rendered a pizza carousel!'
  },
  {
    id: 'pizza-albums',
    title: 'Show Pizza Album',
    description: 'Album-style gallery widget for pizza collections',
    templateUri: 'ui://widget/pizza-albums.html',
    invoking: 'Hand-tossing an album',
    invoked: 'Served a fresh album',
    html: `
<div id="pizzaz-albums-root"></div>
<link rel="stylesheet" href="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-albums-0038.css">
<script type="module" src="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-albums-0038.js"></script>
    `.trim(),
    responseText: 'Rendered a pizza album!'
  },
  {
    id: 'pizza-list',
    title: 'Show Pizza List',
    description: 'List view widget for pizza items',
    templateUri: 'ui://widget/pizza-list.html',
    invoking: 'Hand-tossing a list',
    invoked: 'Served a fresh list',
    html: `
<div id="pizzaz-list-root"></div>
<link rel="stylesheet" href="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-list-0038.css">
<script type="module" src="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-list-0038.js"></script>
    `.trim(),
    responseText: 'Rendered a pizza list!'
  },
  {
    id: 'pizza-video',
    title: 'Show Pizza Video',
    description: 'Video player widget for pizza content',
    templateUri: 'ui://widget/pizza-video.html',
    invoking: 'Hand-tossing a video',
    invoked: 'Served a fresh video',
    html: `
<div id="pizzaz-video-root"></div>
<link rel="stylesheet" href="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-video-0038.css">
<script type="module" src="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-video-0038.js"></script>
    `.trim(),
    responseText: 'Rendered a pizza video!'
  }
]

/**
 * Convert pizzaz widget definitions to mcp-use AppsSdkUIResource format
 * 
 * This demonstrates using mcp-use's AppsSdkUIResource type which:
 * - Automatically sets MIME type to text/html+skybridge
 * - Supports Apps SDK metadata (CSP, widget description, etc.)
 * - Injects structuredContent as window.openai.toolOutput
 * - Works seamlessly with ChatGPT and other Apps SDK clients
 */
export function getPizzazUIResources(): AppsSdkUIResource[] {
  return pizzazWidgets.map(widget => ({
    type: 'appsSdk',
    name: widget.id,
    title: widget.title,
    description: widget.description,
    htmlTemplate: widget.html,
    size: ['800px', '600px'],
    props: {
      pizzaTopping: {
        type: 'string',
        description: 'Topping to mention when rendering the widget',
        required: true
      }
    },
    appsSdkMetadata: {
      'openai/widgetDescription': widget.description,
      'openai/toolInvocation/invoking': widget.invoking,
      'openai/toolInvocation/invoked': widget.invoked,
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/widgetCSP': {
        connect_domains: [],
        resource_domains: ['https://persistent.oaistatic.com']
      }
    }
  } satisfies AppsSdkUIResource))
}

/**
 * Get a summary of all pizzaz widgets for documentation
 */
export function getPizzazWidgetsSummary() {
  return pizzazWidgets.map(w => ({
    id: w.id,
    title: w.title,
    description: w.description,
    tool: `ui_${w.id}`,
    resource: w.templateUri,
    responseText: w.responseText
  }))
}

/**
 * Create widget metadata for a specific widget
 */
export function widgetMeta(widget: PizzazWidgetDefinition) {
  return {
    'openai/outputTemplate': widget.templateUri,
    'openai/toolInvocation/invoking': widget.invoking,
    'openai/toolInvocation/invoked': widget.invoked,
    'openai/widgetAccessible': true,
    'openai/resultCanProduceWidget': true
  } as const
}

/**
 * Get widget by ID
 */
export function getWidgetById(id: string): PizzazWidgetDefinition | undefined {
  return pizzazWidgets.find(w => w.id === id)
}

/**
 * Get widget by template URI
 */
export function getWidgetByUri(uri: string): PizzazWidgetDefinition | undefined {
  return pizzazWidgets.find(w => w.templateUri === uri)
}

