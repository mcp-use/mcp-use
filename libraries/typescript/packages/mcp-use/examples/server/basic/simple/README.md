# Simple MCP Server Example

A minimal example of an MCP server with a single "hello world" tool.

## Features

- Single `hello-world` tool that returns "Hello World!"
- MCP Inspector integration
- TypeScript support
- Simple and easy to understand

## Getting Started

### Development

```bash
# Install dependencies
yarn install

# Start development server
yarn dev
```

This will start:
- MCP server on port 3000
- MCP Inspector at http://localhost:3000/inspector

### Production

```bash
# Build the server
yarn build

# Run the built server
yarn start
```

## Usage

The server provides one tool:

- `hello-world` - Returns "Hello World!" message

## Project Structure

```
simple-example/
├── src/
│   └── server.ts              # MCP server with hello world tool
├── dist/                      # Built files
├── package.json
├── tsconfig.json
└── README.md
```

## API Reference

### MCP Tools

- `hello-world` - A simple tool that returns hello world

## Learn More

- [MCP Documentation](https://modelcontextprotocol.io)
- [mcp-use Documentation](https://docs.mcp-use.io)
