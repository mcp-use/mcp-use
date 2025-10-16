export interface MCPResource {
  uri?: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

interface MCPResourceItem {
  type: string;
  resource?: MCPResource;
}

/**
 * Extracts MCP-UI resources from a tool invocation result
 * @param result - The tool invocation result (can be a JSON string or object)
 * @returns An array of MCP resources found in the result
 */
export function extractMCPResources(
  result: string | object | undefined
): MCPResource[] {
  if (!result) {
    return [];
  }

  try {
    // Parse result if it's a string
    const parsedResult =
      typeof result === 'string' ? JSON.parse(result) : result;

    // Check if the result has a content array
    if (parsedResult.content && Array.isArray(parsedResult.content)) {
      // Filter and extract resources
      return parsedResult.content
        .filter(
          (item: MCPResourceItem) => item.type === 'resource' && item.resource
        )
        .map((item: MCPResourceItem) => item.resource) as MCPResource[];
    }
  } catch (e) {
    console.log('Could not parse tool result for MCP resources:', e);
  }

  return [];
}

/**
 * Checks if a resource is an MCP-UI resource
 * @param resource - The resource object to check
 * @returns True if the resource has a UI URI
 */
export function isMCPUIResource(resource: MCPResource): boolean {
  return resource.uri?.startsWith('ui://') ?? false;
}

