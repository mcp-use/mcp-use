/**
 * Internal boundary for official MCP SDK v2 server imports.
 *
 * mcp-use owns the Hono/runtime/product shell; `@modelcontextprotocol/server`
 * owns protocol primitives and transport semantics. Keep version-sensitive SDK
 * construction here so transport mounts and server replay code do not grow their
 * own direct SDK import surfaces.
 *
 * SDK-private field access is still migration-only in a few HMR/session paths.
 * New code should add a named bridge helper here before touching SDK internals.
 */
import {
  McpServer as OfficialMcpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceTemplate as OfficialResourceTemplate,
  WebStandardStreamableHTTPServerTransport as OfficialWebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  RegisteredPrompt,
  RegisteredResource,
  RegisteredResourceTemplate,
  RegisteredTool,
} from "@modelcontextprotocol/server";

export { ProtocolError, ProtocolErrorCode };
export type {
  CreateMessageRequest,
  CreateMessageResult,
  RegisteredPrompt,
  RegisteredResource,
  RegisteredResourceTemplate,
  RegisteredTool,
};

export type SdkMcpServer = OfficialMcpServer;
type SdkResourceTemplate = OfficialResourceTemplate;
type SdkStreamableHttpTransport =
  OfficialWebStandardStreamableHTTPServerTransport;

export function createSdkMcpServer(
  serverInfo: ConstructorParameters<typeof OfficialMcpServer>[0],
  options: ConstructorParameters<typeof OfficialMcpServer>[1]
): SdkMcpServer {
  return new OfficialMcpServer(serverInfo, options);
}

export function createSdkResourceTemplate(
  uriTemplate: ConstructorParameters<typeof OfficialResourceTemplate>[0],
  options: ConstructorParameters<typeof OfficialResourceTemplate>[1]
): SdkResourceTemplate {
  return new OfficialResourceTemplate(uriTemplate, options);
}

export function createSdkStreamableHttpTransport(
  options: ConstructorParameters<
    typeof OfficialWebStandardStreamableHTTPServerTransport
  >[0]
): SdkStreamableHttpTransport {
  return new OfficialWebStandardStreamableHTTPServerTransport(options);
}
