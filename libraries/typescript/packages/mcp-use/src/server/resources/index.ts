import type { ResourceDefinition } from "../types/index.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { ResourceTemplateDefinition } from "../types/index.js";

export interface ResourceServerContext {
  server: {
    registerResource(
      name: string,
      uri: string,
      metadata: {
        title?: string;
        description?: string;
        mimeType: string;
        _meta?: Record<string, unknown>;
      },
      readCallback: () => Promise<ReadResourceResult>
    ): void;
  };
  registeredResources: string[];
}

/**
 * Define a static resource that can be accessed by clients
 *
 * Registers a resource with the MCP server that clients can access via HTTP.
 * Resources are static content like files, data, or pre-computed results that
 * can be retrieved by clients without requiring parameters.
 *
 * @param resourceDefinition - Configuration object containing resource metadata and handler function
 * @param resourceDefinition.name - Unique identifier for the resource
 * @param resourceDefinition.uri - URI pattern for accessing the resource
 * @param resourceDefinition.title - Optional human-readable title for the resource
 * @param resourceDefinition.description - Optional description of the resource
 * @param resourceDefinition.mimeType - MIME type of the resource content
 * @param resourceDefinition.annotations - Optional annotations (audience, priority, lastModified)
 * @param resourceDefinition.readCallback - Async callback function that returns the resource content
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * server.resource({
 *   name: 'config',
 *   uri: 'config://app-settings',
 *   title: 'Application Settings',
 *   mimeType: 'application/json',
 *   description: 'Current application configuration',
 *   annotations: {
 *     audience: ['user'],
 *     priority: 0.8
 *   },
 *   readCallback: async () => ({
 *     contents: [{
 *       uri: 'config://app-settings',
 *       mimeType: 'application/json',
 *       text: JSON.stringify({ theme: 'dark', language: 'en' })
 *     }]
 *   })
 * })
 * ```
 */
export function registerResource(
  this: ResourceServerContext,
  resourceDefinition: ResourceDefinition
): ResourceServerContext {
  this.server.registerResource(
    resourceDefinition.name,
    resourceDefinition.uri,
    {
      title: resourceDefinition.title,
      description: resourceDefinition.description,
      mimeType: resourceDefinition.mimeType,
      _meta: resourceDefinition._meta,
    },
    async () => {
      return await resourceDefinition.readCallback();
    }
  );
  this.registeredResources.push(resourceDefinition.name);
  return this;
}

export interface ResourceTemplateServerContext {
  server: {
    registerResource(
      name: string,
      template: ResourceTemplate,
      metadata: any,
      readCallback: (uri: URL) => Promise<any>
    ): void;
  };
  registeredResources: string[];
  parseTemplateUri(uriTemplate: string, uri: string): Record<string, string>;
}

/**
 * Define a dynamic resource template with parameters
 *
 * Registers a parameterized resource template with the MCP server. Templates use URI
 * patterns with placeholders that can be filled in at request time, allowing dynamic
 * resource generation based on parameters.
 *
 * @param resourceTemplateDefinition - Configuration object for the resource template
 * @param resourceTemplateDefinition.name - Unique identifier for the template
 * @param resourceTemplateDefinition.resourceTemplate - ResourceTemplate object with uriTemplate and metadata
 * @param resourceTemplateDefinition.readCallback - Async callback function that generates resource content from URI and params
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * server.resourceTemplate({
 *   name: 'user-profile',
 *   resourceTemplate: {
 *     uriTemplate: 'user://{userId}/profile',
 *     name: 'User Profile',
 *     mimeType: 'application/json'
 *   },
 *   readCallback: async (uri, params) => ({
 *     contents: [{
 *       uri: uri.toString(),
 *       mimeType: 'application/json',
 *       text: JSON.stringify({ userId: params.userId, name: 'John Doe' })
 *     }]
 *   })
 * })
 * ```
 */
export function registerResourceTemplate(
  this: ResourceTemplateServerContext,
  resourceTemplateDefinition: ResourceTemplateDefinition
): ResourceTemplateServerContext {
  // Create ResourceTemplate instance from SDK
  const template = new ResourceTemplate(
    resourceTemplateDefinition.resourceTemplate.uriTemplate,
    {
      list: undefined, // Optional: callback to list all matching resources
      complete: undefined, // Optional: callback for auto-completion
    }
  );

  // Create metadata object with optional fields
  const metadata: any = {};
  if (resourceTemplateDefinition.title) {
    metadata.title = resourceTemplateDefinition.title;
  }
  if (
    resourceTemplateDefinition.description ||
    resourceTemplateDefinition.resourceTemplate.description
  ) {
    metadata.description =
      resourceTemplateDefinition.description ||
      resourceTemplateDefinition.resourceTemplate.description;
  }
  if (resourceTemplateDefinition.resourceTemplate.mimeType) {
    metadata.mimeType = resourceTemplateDefinition.resourceTemplate.mimeType;
  }
  if (resourceTemplateDefinition.annotations) {
    metadata.annotations = resourceTemplateDefinition.annotations;
  }

  this.server.registerResource(
    resourceTemplateDefinition.name,
    template,
    metadata,
    async (uri: URL) => {
      // Parse URI parameters from the template
      const params = this.parseTemplateUri(
        resourceTemplateDefinition.resourceTemplate.uriTemplate,
        uri.toString()
      );
      return await resourceTemplateDefinition.readCallback(uri, params);
    }
  );
  this.registeredResources.push(resourceTemplateDefinition.name);
  return this;
}
