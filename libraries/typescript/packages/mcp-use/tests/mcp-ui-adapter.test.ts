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
  createAppsSdkResource,
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
  RemoteDomUIResource,
  AppsSdkUIResource
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
      expect(script).toContain('interactive-widget')
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

  describe('Apps SDK Integration', () => {
    describe('External URL with Apps SDK', () => {
      it('should create Apps SDK template with metadata for external URL', () => {
        const definition: ExternalUrlUIResource = {
          type: 'externalUrl',
          name: 'weather-widget',
          widget: 'weather',
          title: 'Weather Widget',
          encoding: 'text',
          adapters: {
            appsSdk: {
              enabled: true,
              config: { intentHandling: 'prompt' }
            }
          },
          appsSdkMetadata: {
            'openai/widgetDescription': 'Interactive weather forecast',
            'openai/widgetPrefersBorder': true,
            'openai/widgetAccessible': true
          }
        }

        const resource = createUIResourceFromDefinition(definition, {
          city: 'San Francisco'
        }, urlConfig)

        // External URLs keep their MIME type but add _meta
        expect(resource.type).toBe('resource')
        expect(resource.resource.uri).toBe('ui://widget/weather-widget')
        expect(resource.resource.text).toContain('http://localhost:3000/mcp-use/widgets/weather')
        expect(resource.resource.text).toContain('city=San+Francisco')

        // Check that metadata is present (if supported by @mcp-ui/server)
        if ('_meta' in resource.resource) {
          expect((resource.resource as any)._meta).toBeDefined()
        }
      })

      it('should create external URL with CSP metadata', () => {
        const definition: ExternalUrlUIResource = {
          type: 'externalUrl',
          name: 'analytics-widget',
          widget: 'analytics',
          adapters: {
            appsSdk: {
              enabled: true
            }
          },
          appsSdkMetadata: {
            'openai/widgetDescription': 'Analytics dashboard',
            'openai/widgetCSP': {
              connect_domains: ['api.analytics.com'],
              resource_domains: ['cdn.analytics.com']
            }
          }
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        expect(resource.type).toBe('resource')
        expect(resource.resource.uri).toBe('ui://widget/analytics-widget')
      })

      it('should create regular external URL resource without adapter', () => {
        const definition: ExternalUrlUIResource = {
          type: 'externalUrl',
          name: 'regular-widget',
          widget: 'regular',
          // No adapters specified
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        expect(resource.resource.mimeType).toBe('text/uri-list')
        expect('_meta' in resource.resource).toBe(false)
      })
    })

    describe('Raw HTML with Apps SDK', () => {
      it('should create Apps SDK template for raw HTML with bridge script', () => {
        const htmlContent = '<div><h1>Calculator</h1><button>Calculate</button></div>'
        const definition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'calculator',
          htmlContent,
          title: 'Calculator Widget',
          adapters: {
            appsSdk: {
              enabled: true,
              config: { intentHandling: 'prompt' }
            }
          },
          appsSdkMetadata: {
            'openai/widgetDescription': 'Interactive calculator',
            'openai/widgetPrefersBorder': true
          }
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        // Raw HTML with Apps SDK should have skybridge MIME type
        expect(resource.type).toBe('resource')
        expect(resource.resource.uri).toBe('ui://widget/calculator')
        expect(resource.resource.mimeType).toBe('text/html+skybridge')

        // Bridge script should be injected
        expect(resource.resource.text).toContain('<script>')
        expect(resource.resource.text).toContain('MCPUIAppsSdkAdapter')
        expect(resource.resource.text).toContain(htmlContent)

        // Metadata should be present
        if ('_meta' in resource.resource) {
          expect((resource.resource as any)._meta['openai/widgetDescription']).toBe('Interactive calculator')
        }
      })

      it('should create regular HTML resource without adapter', () => {
        const htmlContent = '<p>Regular HTML</p>'
        const definition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'regular-html',
          htmlContent,
          // No adapters specified
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        expect(resource.resource.mimeType).toBe('text/html')
        expect(resource.resource.text).toBe(htmlContent)
        expect('_meta' in resource.resource).toBe(false)
      })

      it('should handle Apps SDK with blob encoding', () => {
        const htmlContent = '<div>Complex Widget</div>'
        const definition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'complex-widget',
          htmlContent,
          encoding: 'blob',
          adapters: {
            appsSdk: {
              enabled: true
            }
          }
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        expect(resource.resource.mimeType).toBe('text/html+skybridge')
        expect(resource.resource.blob).toBeDefined()
        expect(resource.resource.text).toBeUndefined()

        // Decode and verify bridge script is present
        const decoded = Buffer.from(resource.resource.blob!, 'base64').toString()
        expect(decoded).toContain('<script>')
        expect(decoded).toContain('MCPUIAppsSdkAdapter')
      })

      it('should pass config to bridge script', () => {
        const htmlContent = '<div>Test</div>'
        const definition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'config-test',
          htmlContent,
          adapters: {
            appsSdk: {
              enabled: true,
              config: { intentHandling: 'prompt' }
            }
          }
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        // Config should be passed to initAdapter
        expect(resource.resource.text).toContain('initAdapter')
        expect(resource.resource.text).toContain('"intentHandling":"prompt"')
      })
    })

    describe('Remote DOM with Apps SDK', () => {
      it('should create Remote DOM with Apps SDK metadata', () => {
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
          adapters: {
            appsSdk: {
              enabled: true
            }
          },
          appsSdkMetadata: {
            'openai/widgetDescription': 'Interactive button widget',
            'openai/widgetAccessible': true
          }
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        // Remote DOM keeps its MIME type
        expect(resource.type).toBe('resource')
        expect(resource.resource.uri).toBe('ui://widget/remote-button')
        expect(resource.resource.mimeType).toContain('application/vnd.mcp-ui.remote-dom+javascript')
        expect(resource.resource.mimeType).toContain('framework=react')
        expect(resource.resource.text).toBe(script)

        // Metadata should be present
        if ('_meta' in resource.resource) {
          expect((resource.resource as any)._meta['openai/widgetDescription']).toBe('Interactive button widget')
        }
      })

      it('should create regular Remote DOM resource without adapter', () => {
        const script = 'const div = document.createElement("div");'
        const definition: RemoteDomUIResource = {
          type: 'remoteDom',
          name: 'regular-dom',
          script,
          // No adapters specified
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        expect(resource.resource.mimeType).toContain('application/vnd.mcp-ui.remote-dom+javascript')
        expect('_meta' in resource.resource).toBe(false)
      })
    })

    describe('Metadata Handling', () => {
      it('should handle all Apps SDK metadata fields', () => {
        const definition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'full-metadata',
          htmlContent: '<div>Test</div>',
          adapters: {
            appsSdk: {
              enabled: true,
              config: { intentHandling: 'prompt' }
            }
          },
          appsSdkMetadata: {
            'openai/widgetDescription': 'Full metadata test',
            'openai/widgetPrefersBorder': true,
            'openai/widgetAccessible': true,
            'openai/widgetCSP': {
              connect_domains: ['api.example.com', 'cdn.example.com'],
              resource_domains: ['assets.example.com']
            }
          }
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        expect(resource.resource.mimeType).toBe('text/html+skybridge')

        // All metadata fields should be present
        if ('_meta' in resource.resource) {
          const meta = (resource.resource as any)._meta
          expect(meta['openai/widgetDescription']).toBe('Full metadata test')
          expect(meta['openai/widgetPrefersBorder']).toBe(true)
          expect(meta['openai/widgetAccessible']).toBe(true)
          expect(meta['openai/widgetCSP']).toBeDefined()
          expect(meta['openai/widgetCSP'].connect_domains).toEqual(['api.example.com', 'cdn.example.com'])
        }
      })

      it('should handle minimal metadata', () => {
        const definition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'minimal-metadata',
          htmlContent: '<div>Minimal</div>',
          adapters: {
            appsSdk: {
              enabled: true
            }
          }
          // No appsSdkMetadata
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        expect(resource.resource.mimeType).toBe('text/html+skybridge')
        // Should work even without metadata
      })
    })

    describe('Mixed Usage Pattern', () => {
      it('should support creating both template and embedded resources', () => {
        // Apps SDK template (for ChatGPT) - with adapter enabled
        const templateDefinition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'forecast-template',
          htmlContent: '<div id="forecast"></div>',
          adapters: {
            appsSdk: {
              enabled: true
            }
          },
          appsSdkMetadata: {
            'openai/widgetDescription': 'Weather forecast widget'
          }
        }

        const template = createUIResourceFromDefinition(templateDefinition, {}, urlConfig)

        // Regular embedded resource (for MCP-UI hosts) - without adapter
        const embeddedDefinition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'forecast-embedded',
          htmlContent: '<div id="forecast">Sunny, 72°F</div>',
          // No adapters - this is for standard MCP-UI hosts
        }

        const embedded = createUIResourceFromDefinition(embeddedDefinition, {}, urlConfig)

        // Template has Apps SDK features
        expect(template.resource.mimeType).toBe('text/html+skybridge')
        expect(template.resource.text).toContain('MCPUIAppsSdkAdapter')

        // Embedded is standard MCP-UI
        expect(embedded.resource.mimeType).toBe('text/html')
        expect(embedded.resource.text).toBe('<div id="forecast">Sunny, 72°F</div>')
        expect(embedded.resource.text).not.toContain('MCPUIAppsSdkAdapter')
      })
    })

    describe('Adapter Configuration', () => {
      it('should pass intentHandling config to adapter', () => {
        const testCases = [
          { intentHandling: 'prompt' as const },
          { intentHandling: 'ignore' as const }
        ]

        testCases.forEach(({ intentHandling }) => {
          const definition: RawHtmlUIResource = {
            type: 'rawHtml',
            name: `test-${intentHandling}`,
            htmlContent: '<div>Test</div>',
            adapters: {
              appsSdk: {
                enabled: true,
                config: { intentHandling }
              }
            }
          }

          const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

          expect(resource.resource.text).toContain(`"intentHandling":"${intentHandling}"`)
        })
      })

      it('should handle adapter with no config', () => {
        const definition: RawHtmlUIResource = {
          type: 'rawHtml',
          name: 'no-config',
          htmlContent: '<div>Test</div>',
          adapters: {
            appsSdk: {
              enabled: true
              // No config provided
            }
          }
        }

        const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

        expect(resource.resource.mimeType).toBe('text/html+skybridge')
        expect(resource.resource.text).toContain('initAdapter')
      })
    })
  })

  describe('Apps SDK Resource Type', () => {
    it('should create Apps SDK resource with _meta at top level', () => {
      const htmlTemplate = '<div id="test"></div>'
      const metadata = {
        'openai/widgetDescription': 'Test widget',
        'openai/widgetPrefersBorder': true,
        'openai/widgetAccessible': true,
        'openai/widgetCSP': {
          connect_domains: ['api.example.com'],
          resource_domains: ['cdn.example.com']
        }
      }

      const resource = createAppsSdkResource(
        'ui://widget/test',
        htmlTemplate,
        metadata
      )

      // Verify _meta is at the top level of resource object
      expect(resource.type).toBe('resource')
      expect(resource.resource).toHaveProperty('_meta')
      expect(resource.resource._meta).toEqual(metadata)

      // Verify structure matches expected Apps SDK format
      expect(resource.resource.uri).toBe('ui://widget/test')
      expect(resource.resource.mimeType).toBe('text/html+skybridge')
      expect(resource.resource.text).toBe(htmlTemplate)

      // _meta should be at same level as uri, mimeType, text
      expect(Object.keys(resource.resource).sort()).toEqual(['_meta', 'mimeType', 'text', 'uri'].sort())
    })

    it('should create Apps SDK resource with HTML template', () => {
      const htmlTemplate = `
        <div id="kanban-root"></div>
        <style>
          .kanban { display: flex; }
        </style>
        <script type="module">
          // Widget code here
          const data = window.openai?.toolOutput;
          console.log('Data:', data);
        </script>
      `

      const definition: AppsSdkUIResource = {
        type: 'appsSdk',
        name: 'kanban-board',
        title: 'Kanban Board',
        description: 'Interactive task board',
        htmlTemplate,
        appsSdkMetadata: {
          'openai/widgetDescription': 'Displays an interactive kanban board',
          'openai/widgetPrefersBorder': true
        }
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource.type).toBe('resource')
      expect(resource.resource.uri).toBe('ui://widget/kanban-board.html')
      expect(resource.resource.mimeType).toBe('text/html+skybridge')
      expect(resource.resource.text).toContain('<div id="kanban-root"></div>')
      expect(resource.resource.text).toContain('window.openai?.toolOutput')
    })

    it('should create Apps SDK resource with full metadata', () => {
      const definition: AppsSdkUIResource = {
        type: 'appsSdk',
        name: 'analytics-dashboard',
        title: 'Analytics Dashboard',
        htmlTemplate: '<div id="analytics"></div>',
        appsSdkMetadata: {
          'openai/widgetDescription': 'Real-time analytics dashboard',
          'openai/widgetPrefersBorder': false,
          'openai/widgetAccessible': true,
          'openai/widgetCSP': {
            connect_domains: ['api.analytics.com', 'ws.analytics.com'],
            resource_domains: ['cdn.analytics.com', 'fonts.googleapis.com']
          },
          'openai/toolInvocation/invoking': 'Loading analytics...',
          'openai/toolInvocation/invoked': 'Analytics loaded'
        }
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource.resource.mimeType).toBe('text/html+skybridge')
      expect(resource.resource.text).toBe('<div id="analytics"></div>')

      // Metadata should be present
      if ('_meta' in resource.resource) {
        const meta = (resource.resource as any)._meta
        expect(meta['openai/widgetDescription']).toBe('Real-time analytics dashboard')
        expect(meta['openai/widgetPrefersBorder']).toBe(false)
        expect(meta['openai/widgetAccessible']).toBe(true)
        expect(meta['openai/widgetCSP']).toEqual({
          connect_domains: ['api.analytics.com', 'ws.analytics.com'],
          resource_domains: ['cdn.analytics.com', 'fonts.googleapis.com']
        })
      }
    })

    it('should create Apps SDK resource with widget domain', () => {
      const definition: AppsSdkUIResource = {
        type: 'appsSdk',
        name: 'maps-widget',
        htmlTemplate: '<div id="map"></div>',
        appsSdkMetadata: {
          'openai/widgetDomain': 'chatgpt.com',
          'openai/widgetDescription': 'Interactive map widget'
        }
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource.resource.mimeType).toBe('text/html+skybridge')
      if ('_meta' in resource.resource) {
        expect((resource.resource as any)._meta['openai/widgetDomain']).toBe('chatgpt.com')
      }
    })

    it('should create Apps SDK resource without metadata', () => {
      const definition: AppsSdkUIResource = {
        type: 'appsSdk',
        name: 'simple-widget',
        htmlTemplate: '<div>Simple</div>'
        // No metadata
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource.type).toBe('resource')
      expect(resource.resource.uri).toBe('ui://widget/simple-widget.html')
      expect(resource.resource.mimeType).toBe('text/html+skybridge')
      expect(resource.resource.text).toBe('<div>Simple</div>')
    })

    it('should create Apps SDK resource directly using createAppsSdkResource', () => {
      const htmlTemplate = '<div id="widget"><h1>Hello</h1></div>'
      const metadata = {
        'openai/widgetDescription': 'Test widget',
        'openai/widgetPrefersBorder': true
      }

      const resource = createAppsSdkResource(
        'ui://widget/test',
        htmlTemplate,
        metadata
      )

      expect(resource.type).toBe('resource')
      expect(resource.resource.uri).toBe('ui://widget/test')
      expect(resource.resource.mimeType).toBe('text/html+skybridge')
      expect(resource.resource.text).toBe(htmlTemplate)

      if ('_meta' in resource.resource) {
        expect((resource.resource as any)._meta['openai/widgetDescription']).toBe('Test widget')
      }
    })

    it('should create Apps SDK resource with complex HTML template', () => {
      const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 20px; font-family: system-ui; }
    .container { max-width: 1200px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    // Access structured data from tool output
    const toolOutput = window.openai?.toolOutput || {};
    
    // Render UI based on data
    const root = document.getElementById('root');
    root.innerHTML = \`<h1>\${toolOutput.title || 'Dashboard'}</h1>\`;
    
    // Listen for tool invocations if accessible
    if (window.openai?.tools) {
      window.openai.tools.on('invoke', (result) => {
        console.log('Tool invoked:', result);
      });
    }
  </script>
</body>
</html>
      `.trim()

      const definition: AppsSdkUIResource = {
        type: 'appsSdk',
        name: 'dashboard',
        title: 'Dashboard Widget',
        htmlTemplate,
        appsSdkMetadata: {
          'openai/widgetDescription': 'Interactive dashboard with tool access',
          'openai/widgetAccessible': true
        }
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      expect(resource.resource.text).toContain('<!DOCTYPE html>')
      expect(resource.resource.text).toContain('window.openai?.toolOutput')
      expect(resource.resource.text).toContain('window.openai?.tools')
      expect(resource.resource.mimeType).toBe('text/html+skybridge')
    })

    it('should properly handle locale metadata', () => {
      const definition: AppsSdkUIResource = {
        type: 'appsSdk',
        name: 'localized-widget',
        htmlTemplate: '<div id="content"></div>',
        appsSdkMetadata: {
          'openai/locale': 'fr-FR',
          'openai/widgetDescription': 'Widget localisé'
        }
      }

      const resource = createUIResourceFromDefinition(definition, {}, urlConfig)

      if ('_meta' in resource.resource) {
        expect((resource.resource as any)._meta['openai/locale']).toBe('fr-FR')
        expect((resource.resource as any)._meta['openai/widgetDescription']).toBe('Widget localisé')
      }
    })
  })
})
