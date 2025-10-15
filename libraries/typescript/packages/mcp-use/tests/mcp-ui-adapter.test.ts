/**
 * Tests for MCP-UI Adapter
 *
 * These tests verify that the adapter pure functions correctly generate UIResource objects
 * matching the @mcp-ui/server format for all content types.
 */

import { describe, it, expect } from 'vitest'
import {
  buildWidgetUrl,
  createExternalUrlResource,
  createRawHtmlResource,
  createRemoteDomResource,
  createUIResourceFromDefinition,
  type UrlConfig
} from '../src/server/adapters/mcp-ui-adapter.js'
import {
  generateWidgetHtml,
  generateRemoteDomScript
} from './helpers/widget-generators.js'
import type {
  ExternalUrlUIResource,
  RawHtmlUIResource,
  RemoteDomUIResource
} from 'mcp-use/server'

describe('MCP-UI Adapter', () => {
  const urlConfig: UrlConfig = {
    baseUrl: 'http://localhost',
    port: 3000
  }

  describe('External URL Resources', () => {
    it('should create external URL resource with text encoding', () => {
      const definition: ExternalUrlUIResource = {
        type: 'externalUrl',
        name: 'kanban-board',
        widget: 'kanban-board',
        title: 'Kanban Board',
        encoding: 'text'
      }

      const resource = createUIResourceFromDefinition(definition, {
        theme: 'dark',
        initialTasks: ['task1', 'task2']
      }, urlConfig)

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://widget/kanban-board',
          mimeType: 'text/uri-list',
          text: 'http://localhost:3000/mcp-use/widgets/kanban-board?theme=dark&initialTasks=%5B%22task1%22%2C%22task2%22%5D'
        }
      })
    })

    it('should create external URL resource with blob encoding', () => {
      const definition: ExternalUrlUIResource = {
        type: 'externalUrl',
        name: 'chart-widget',
        widget: 'chart',
        encoding: 'blob'
      }

      const resource = createUIResourceFromDefinition(definition, {
        data: [1, 2, 3]
      }, urlConfig)

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://widget/chart-widget',
          mimeType: 'text/uri-list',
          // Base64 encoded URL
          blob: expect.stringMatching(/^[A-Za-z0-9+/=]+$/)
        }
      })

      // Decode and verify the blob content
      const decodedUrl = Buffer.from(resource.resource.blob!, 'base64').toString()
      expect(decodedUrl).toBe('http://localhost:3000/mcp-use/widgets/chart?data=%5B1%2C2%2C3%5D')
    })

    it('should handle complex object parameters', () => {
      const definition: ExternalUrlUIResource = {
        type: 'externalUrl',
        name: 'dashboard',
        widget: 'dashboard'
      }

      const resource = createUIResourceFromDefinition(definition, {
        config: {
          layout: 'grid',
          columns: 3,
          widgets: ['chart', 'table', 'metrics']
        }
      }, urlConfig)

      expect(resource.resource.text).toContain('config=%7B%22layout%22%3A%22grid%22')
    })

    it('should default to text encoding', () => {
      const definition: ExternalUrlUIResource = {
        type: 'externalUrl',
        name: 'todo-list',
        widget: 'todo-list'
        // No encoding specified
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://widget/todo-list',
          mimeType: 'text/uri-list',
          text: 'http://localhost:3000/mcp-use/widgets/todo-list'
        }
      })
    })
  })

  describe('Raw HTML Resources', () => {
    it('should create raw HTML resource with text encoding', () => {
      const htmlContent = '<div><h1>Hello World</h1></div>'
      const definition: RawHtmlUIResource = {
        type: 'rawHtml',
        name: 'static-widget',
        htmlContent,
        encoding: 'text'
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://widget/static-widget',
          mimeType: 'text/html',
          text: htmlContent
        }
      })
    })

    it('should create raw HTML resource with blob encoding', () => {
      const htmlContent = '<h1>Complex HTML</h1><script>console.log("test")</script>'
      const definition: RawHtmlUIResource = {
        type: 'rawHtml',
        name: 'complex-widget',
        htmlContent,
        encoding: 'blob'
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://widget/complex-widget',
          mimeType: 'text/html',
          blob: Buffer.from(htmlContent).toString('base64')
        }
      })
    })

    it('should generate HTML content with widget metadata', () => {
      const definition: RawHtmlUIResource = {
        type: 'rawHtml',
        name: 'generated-widget',
        htmlContent: '<div>Test</div>',
        title: 'Generated Widget',
        description: 'A dynamically generated widget',
        size: ['800px', '600px']
      }

      const html = generateWidgetHtml(definition, {
        value: 42,
        items: ['a', 'b', 'c']
      })

      expect(html).toContain('Generated Widget')
      expect(html).toContain('A dynamically generated widget')
      expect(html).toContain('width: 800px')
      expect(html).toContain('height: 600px')
      expect(html).toContain('"value":42')
      expect(html).toContain('"items":["a","b","c"]')
    })
  })

  describe('Remote DOM Resources', () => {
    it('should create remote DOM resource with React framework', () => {
      const script = `
        const button = document.createElement('ui-button');
        button.setAttribute('label', 'Click me');
        root.appendChild(button);
      `
      const definition: RemoteDomUIResource = {
        type: 'remoteDom',
        name: 'remote-button',
        script,
        framework: 'react',
        encoding: 'text'
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://widget/remote-button',
          mimeType: 'application/vnd.mcp-ui.remote-dom+javascript; framework=react',
          text: script
        }
      })
    })

    it('should create remote DOM resource with webcomponents framework', () => {
      const script = `
        class MyComponent extends HTMLElement {
          connectedCallback() {
            this.innerHTML = '<h1>Web Component</h1>';
          }
        }
        customElements.define('my-component', MyComponent);
      `
      const definition: RemoteDomUIResource = {
        type: 'remoteDom',
        name: 'web-component',
        script,
        framework: 'webcomponents'
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://widget/web-component',
          mimeType: 'application/vnd.mcp-ui.remote-dom+javascript; framework=webcomponents',
          text: script
        }
      })
    })

    it('should create remote DOM resource with blob encoding', () => {
      const script = 'root.appendChild(document.createElement("div"));'
      const definition: RemoteDomUIResource = {
        type: 'remoteDom',
        name: 'blob-dom',
        script,
        encoding: 'blob'
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://widget/blob-dom',
          mimeType: 'application/vnd.mcp-ui.remote-dom+javascript; framework=react',
          blob: Buffer.from(script).toString('base64')
        }
      })
    })

    it('should generate remote DOM script with widget metadata', () => {
      const definition: RemoteDomUIResource = {
        type: 'remoteDom',
        name: 'interactive-widget',
        script: 'console.log("test")',
        title: 'Interactive Widget',
        description: 'An interactive remote DOM widget'
      }

      const script = generateRemoteDomScript(definition, {
        enabled: true,
        count: 5
      })

      expect(script).toContain('Interactive Widget')
      expect(script).toContain('An interactive remote DOM widget')
      expect(script).toContain('"enabled":true')
      expect(script).toContain('"count":5')
      expect(script).toContain('ui_interactive-widget')
      expect(script).toContain('ui-button')
    })

    it('should default to React framework if not specified', () => {
      const definition: RemoteDomUIResource = {
        type: 'remoteDom',
        name: 'default-framework',
        script: 'const div = document.createElement("div");'
        // No framework specified
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource.resource.mimeType).toContain('framework=react')
    })
  })

  describe('Direct Method Calls', () => {
    it('should create external URL resource directly', () => {
      const resource = createExternalUrlResource(
        'ui://dashboard/main',
        'https://my.analytics.com/dashboard/123',
        'text'
      )

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://dashboard/main',
          mimeType: 'text/uri-list',
          text: 'https://my.analytics.com/dashboard/123'
        }
      })
    })

    it('should create raw HTML resource directly', () => {
      const resource = createRawHtmlResource(
        'ui://content/page',
        '<p>Hello World</p>',
        'text'
      )

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://content/page',
          mimeType: 'text/html',
          text: '<p>Hello World</p>'
        }
      })
    })

    it('should create remote DOM resource directly', () => {
      const resource = createRemoteDomResource(
        'ui://component/button',
        'const btn = document.createElement("button");',
        'webcomponents',
        'text'
      )

      expect(resource).toEqual({
        type: 'resource',
        resource: {
          uri: 'ui://component/button',
          mimeType: 'application/vnd.mcp-ui.remote-dom+javascript; framework=webcomponents',
          text: 'const btn = document.createElement("button");'
        }
      })
    })
  })

  describe('URL Building', () => {
    it('should build URL with query parameters', () => {
      const url = buildWidgetUrl('kanban-board', {
        theme: 'dark',
        count: 5
      }, urlConfig)

      expect(url).toBe('http://localhost:3000/mcp-use/widgets/kanban-board?theme=dark&count=5')
    })

    it('should handle null and undefined values in parameters', () => {
      const url = buildWidgetUrl('test', {
        valid: 'value',
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        zero: 0,
        falseBool: false
      }, urlConfig)

      expect(url).toContain('valid=value')
      expect(url).not.toContain('nullValue')
      expect(url).not.toContain('undefinedValue')
      expect(url).toContain('emptyString=')
      expect(url).toContain('zero=0')
      expect(url).toContain('falseBool=false')
    })

    it('should JSON stringify complex objects in URL parameters', () => {
      const definition: ExternalUrlUIResource = {
        type: 'externalUrl',
        name: 'complex-params',
        widget: 'complex'
      }

      const resource = createUIResourceFromDefinition(definition, {
        nested: {
          array: [1, 2, { key: 'value' }],
          bool: true,
          number: 42
        }
      }, urlConfig)

      const url = resource.resource.text
      expect(url).toBeDefined()
      expect(url).toContain('nested=%7B%22array')

      // Decode and verify the parameter
      const urlObj = new URL(url!)
      const nestedParam = urlObj.searchParams.get('nested')
      expect(nestedParam).toBeDefined()
      const parsed = JSON.parse(nestedParam!)
      expect(parsed).toEqual({
        array: [1, 2, { key: 'value' }],
        bool: true,
        number: 42
      })
    })

    it('should handle empty parameters', () => {
      const url = buildWidgetUrl('empty', undefined, urlConfig)
      expect(url).toBe('http://localhost:3000/mcp-use/widgets/empty')
    })
  })

  describe('Error Handling', () => {
    it('should handle empty widget name', () => {
      const definition: ExternalUrlUIResource = {
        type: 'externalUrl',
        name: '',
        widget: ''
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource.resource.uri).toBe('ui://widget/')
      expect(resource.resource.text).toBe('http://localhost:3000/mcp-use/widgets/')
    })
  })
})
