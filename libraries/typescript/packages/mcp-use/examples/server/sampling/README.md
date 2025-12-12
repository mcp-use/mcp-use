# Sampling Example Server

This example demonstrates how to create an MCP server that uses sampling to request LLM completions from connected clients.

## Features

This server includes three example tools that use sampling:

1. **analyze-sentiment** - Analyzes text sentiment using the client's LLM
2. **summarize-text** - Summarizes text using the client's LLM
3. **translate-text** - Translates text to another language using the client's LLM

## Running the Server

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
```

The server will start on port 3001 (or the port specified in the `PORT` environment variable).

## Requirements

This server requires a client with sampling support. The client must provide a `samplingCallback` when initializing the MCP client.

See `examples/client/sampling-client.ts` for a complete client example.

## How It Works

1. The server defines tools that can request LLM completions
2. When a tool is called, it uses `ctx.sample()` or `server.createMessage()` to request a completion from the client
3. The client's `samplingCallback` handles the request and returns a response
4. The tool processes the response and returns it to the caller

## Example Usage

Once the server is running and connected to a client with sampling support, you can call the tools:

```typescript
// Analyze sentiment
await client.callTool('analyze-sentiment', {
  text: 'I love this product!'
})

// Summarize text
await client.callTool('summarize-text', {
  text: 'Long text here...',
  maxLength: 50
})

// Translate text
await client.callTool('translate-text', {
  text: 'Hello, world!',
  targetLanguage: 'Spanish'
})
```
