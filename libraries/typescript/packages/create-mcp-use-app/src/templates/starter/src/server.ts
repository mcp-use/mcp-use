import { createMCPServer } from 'mcp-use/server'
import type {
  ExternalUrlUIResource,
  RemoteDomUIResource,
  AppsSdkUIResource
} from 'mcp-use/server'
import { quickPollRemoteDomScript } from './remoteDom'

// Create server instance
const server = createMCPServer('my-mcp-server', {
  version: '1.0.0',
  description: 'My first MCP server',
})

// ==============[Tools]=======================

// Define a simple tool
server.tool({
  name: 'greet',
  description: 'Greet someone by name',
  inputs: [
    { name: 'name', type: 'string', required: true }
  ],
  cb: async ({ name }: { name: string }) => {
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${name}! Welcome to MCP.`
        }
      ]
    }
  }
})


// Async tool with external API call
server.tool({
  name: 'fetch-weather',
  description: 'Fetch the weather for a city',
  inputs: [
    { name: 'city', type: 'string', required: true }
  ],
  cb: async ({ city }: { city: string }) => {
    const response = await fetch(`https://wttr.in/${city}?format=j1`)
    const data: any = await response.json()
    const current = data.current_condition[0]
    return {
      content: [{
        type: 'text',
        text: `The weather in ${city} is ${current.weatherDesc[0].value}. Temperature: ${current.temp_C}°C, Humidity: ${current.humidity}%`
      }]
    }
  }
})


// ============================================================================
// ==============[UI Resources (registers tools and resources)]================

// Define an MCP-UI External URL resource for the server
server.uiResource({
  type: 'externalUrl',
  name: 'kanban-board',
  widget: 'kanban-board',
  title: 'Kanban Board',
  description: 'Interactive task management board with drag-and-drop support',
  props: {
    initialTasks: {
      type: 'array',
      description: 'Initial tasks to display on the board',
      required: false,
    },
    theme: {
      type: 'string',
      description: 'Visual theme for the board (light/dark)',
      required: false,
      default: 'light'
    },
    columns: {
      type: 'array',
      description: 'Column configuration for the board',
      required: false,
    }
  }
} satisfies ExternalUrlUIResource)


// Define an MCP-UI Remote DOM resource for the server
server.uiResource({
  type: 'remoteDom',
  name: 'quick-poll',
  title: 'Quick Poll',
  description: 'Create instant polls with interactive voting',
  script: quickPollRemoteDomScript,
  framework: 'react',
  encoding: 'text',
  size: ['500px', '450px'],
  props: {
    question: {
      type: 'string',
      description: 'The poll question',
      default: 'What is your favorite framework?'
    },
    options: {
      type: 'array',
      description: 'Poll options',
      default: ['React', 'Vue', 'Svelte']
    }
  }
} satisfies RemoteDomUIResource)


// Define an OpenAI Apps SDK resource for a ChatGPT compatible widget
server.uiResource({
  type: 'appsSdk',
  name: 'pizzaz-map-apps-sdk',
  title: 'Show Pizza Map',
  description: 'Interactive map widget for displaying pizza locations',
  htmlTemplate: `
    <div id="pizzaz-root"></div>
    <link rel="stylesheet" href="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-0038.css">
    <script type="module" src="https://persistent.oaistatic.com/ecosystem-built-assets/pizzaz-0038.js"></script>
  `.trim(),
  size: ['800px', '600px'],
  props: {
    pizzaTopping: {
      type: 'string',
      description: 'Topping to mention when rendering the widget',
      required: true
    }
  },
  appsSdkMetadata: {
    'openai/widgetDescription': 'Interactive map widget for displaying pizza locations',
    'openai/toolInvocation/invoking': 'Hand-tossing a map',
    'openai/toolInvocation/invoked': 'Served a fresh map',
    'openai/widgetAccessible': true,
    'openai/resultCanProduceWidget': true,
    'openai/widgetCSP': {
      connect_domains: [],
      resource_domains: ['https://persistent.oaistatic.com']
    }
  }
} satisfies AppsSdkUIResource);


//============================================
// ==============[Resources]==================

// Define a resource
server.resource({
  name: 'config',
  uri: 'config://settings',
  mimeType: 'application/json',
  description: 'Server configuration',
  readCallback: async () => ({
    contents: [{
      uri: 'config://settings',
      mimeType: 'application/json',
      text: JSON.stringify({
        theme: 'dark',
        language: 'en'
      })
    }]
  })
})


//==========================================
// ==============[Prompts]==================

// Define a prompt template for code review
server.prompt({
  name: 'review-code',
  description: 'Review code for best practices and potential issues',
  args: [
    { name: 'code', type: 'string', required: true }
  ],
  cb: async ({ code }: { code: string }) => {
    return {
      content: [{
        type: 'text',
        text: `Please review this code:\n\n${code}`
      }]
    }
  }
})

// Start the server
server.listen(3000)