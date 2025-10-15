/**
 * MCP Server Entry Point
 * 
 * This file serves as the main entry point for the MCP server application.
 * It re-exports all functionality from the server implementation, allowing
 * the CLI and other tools to locate and start the server.
 * 
 * The server is automatically started when this module is imported, making
 * it suitable for both direct execution and programmatic usage.
 */
export * from './src/server.js'

