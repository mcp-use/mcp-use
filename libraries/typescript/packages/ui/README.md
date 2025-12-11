# @mcp-use/ui

Reusable UI components for MCP Use applications.

## Features

- **Chat Components**: Full-featured chat interface with support for multiple LLM providers (OpenAI, Anthropic, Google)
- **OpenAI Component Renderer**: Render OpenAI Apps SDK components with full API bridge support
- **MCP UI Renderer**: Display MCP UI resources with interactive elements

## Installation

```bash
npm install @mcp-use/ui
# or
yarn add @mcp-use/ui
# or
pnpm add @mcp-use/ui
```

## Usage

```typescript
import {
  ChatHeader,
  MessageList,
  ChatInputArea,
  OpenAIComponentRenderer,
  McpUIRenderer,
} from "@mcp-use/ui";
```

## Components

### Chat Components

- `ChatHeader` - Chat interface header with provider configuration
- `MessageList` - Display chat messages with markdown support
- `ChatInputArea` - Input area for sending messages
- `AssistantMessage` - Render AI assistant messages
- `UserMessage` - Render user messages
- `ConfigurationDialog` - Configure LLM provider settings

### Renderers

- `OpenAIComponentRenderer` - Render OpenAI Apps SDK components
- `McpUIRenderer` - Render MCP UI resources

## License

MIT
