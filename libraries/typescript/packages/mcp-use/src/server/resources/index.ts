import type {
  ResourceDefinition,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  ResourceDefinitionWithoutCallback,
  ResourceTemplateDefinitionWithoutCallback,
  FlatResourceTemplateDefinition,
  FlatResourceTemplateDefinitionWithoutCallback,
  ResourceTemplateDefinition,
  EnhancedResourceContext,
} from "../types/index.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ReadResourceResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { TypedCallToolResult } from "../utils/response-helpers.js";
import { convertToolResultToResourceResult } from "./conversion.js";

// Export subscription management
export { ResourceSubscriptionManager } from "./subscriptions.js";

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
 * Supports two patterns:
 * 1. Old API: Single object with readCallback property
 * 2. New API: Definition object + separate callback (like tools)
 *
 * @param resourceDefinition - Configuration object containing resource metadata
 * @param resourceDefinition.name - Unique identifier for the resource
 * @param resourceDefinition.uri - URI pattern for accessing the resource
 * @param resourceDefinition.title - Optional human-readable title for the resource
 * @param resourceDefinition.description - Optional description of the resource
 * @param resourceDefinition.mimeType - MIME type (optional when using callback with response helpers)
 * @param resourceDefinition.annotations - Optional annotations (audience, priority, lastModified)
 * @param callback - Optional separate callback function (new API pattern)
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * // New API: Using response helpers (recommended)
 * server.resource(
 *   { name: 'greeting', uri: 'app://greeting', title: 'Greeting' },
 *   async () => text('Hello World!')
 * )
 *
 * server.resource(
 *   { name: 'config', uri: 'config://settings' },
 *   async () => object({ theme: 'dark', version: '1.0' })
 * )
 *
 * // Old API: Still supported for backward compatibility
 * server.resource({
 *   name: 'config',
 *   uri: 'config://app-settings',
 *   mimeType: 'application/json',
 *   readCallback: async () => ({
 *     contents: [{
 *       uri: 'config://app-settings',
 *       mimeType: 'application/json',
 *       text: JSON.stringify({ theme: 'dark' })
 *     }]
 *   })
 * })
 * ```
 */
export function registerResource(
  this: ResourceServerContext,
  resourceDefinition: ResourceDefinition | ResourceDefinitionWithoutCallback,
  callback?: ReadResourceCallback
): ResourceServerContext {
  // Determine which callback to use
  const actualCallback =
    callback || (resourceDefinition as ResourceDefinition).readCallback;

  if (!actualCallback) {
    throw new Error(
      `Resource '${resourceDefinition.name}' must have either a readCallback property or a callback parameter`
    );
  }

  // Determine MIME type - use from definition if provided, otherwise will be inferred from callback result
  const explicitMimeType = (resourceDefinition as ResourceDefinition).mimeType;

  // Wrap the callback to support both CallToolResult and ReadResourceResult
  const wrappedCallback = async (): Promise<ReadResourceResult> => {
    // Get the HTTP request context from AsyncLocalStorage
    const { getRequestContext, runWithContext } =
      await import("../context-storage.js");
    const { findSessionContext } =
      await import("../tools/tool-execution-helpers.js");

    const initialRequestContext = getRequestContext();

    // Find session context
    const sessions = (this as any).sessions || new Map();
    const { requestContext } = findSessionContext(
      sessions,
      initialRequestContext,
      undefined,
      undefined
    );

    // Create enhanced context (without tool-specific features)
    const enhancedContext = requestContext || {};

    // Execute callback with context
    const executeCallback = async () => {
      if (actualCallback.length >= 1) {
        return await (actualCallback as any)(enhancedContext);
      }
      return await (actualCallback as any)();
    };

    const result = requestContext
      ? await runWithContext(requestContext, executeCallback)
      : await executeCallback();

    // If it's already a ReadResourceResult, return as-is
    if ("contents" in result && Array.isArray(result.contents)) {
      return result as ReadResourceResult;
    }

    // Convert CallToolResult to ReadResourceResult
    return convertToolResultToResourceResult(
      resourceDefinition.uri,
      result as CallToolResult
    );
  };

  // For registration, we need a MIME type
  // If explicit MIME type provided, use it; otherwise use a placeholder
  // The actual MIME type will be determined by the callback result
  const registrationMimeType = explicitMimeType || "text/plain";

  this.server.registerResource(
    resourceDefinition.name,
    resourceDefinition.uri,
    {
      title: resourceDefinition.title,
      description: resourceDefinition.description,
      mimeType: registrationMimeType,
      _meta: resourceDefinition._meta,
    },
    wrappedCallback
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
 * Supports multiple API patterns:
 * 1. Flat structure (recommended): `uriTemplate` directly on definition
 * 2. Nested structure (legacy): `resourceTemplate.uriTemplate`
 * 3. Old API: Single object with readCallback property
 * 4. New API: Definition object + separate callback (like tools)
 *
 * The callback function supports multiple signatures for flexibility:
 * - `async () => ...` - No parameters (for static templates)
 * - `async (uri) => ...` - Just the URI
 * - `async (uri, params) => ...` - URI and extracted parameters
 * - `async (uri, params, ctx) => ...` - URI, parameters, and context (with auth, request, etc.)
 *
 * @param resourceTemplateDefinition - Configuration object for the resource template
 * @param resourceTemplateDefinition.name - Unique identifier for the template
 * @param resourceTemplateDefinition.uriTemplate - URI template (flat structure, recommended)
 * @param resourceTemplateDefinition.resourceTemplate - ResourceTemplate object (nested structure, legacy)
 * @param callback - Optional separate callback function (new API pattern)
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * // Flat structure (recommended)
 * server.resourceTemplate({
 *   name: 'user',
 *   uriTemplate: 'user://{id}',
 *   title: 'User Profile'
 * }, async (uri, { id }) => object(await getUserData(id)))
 *
 * // Minimal signature - no parameters
 * server.resourceTemplate({
 *   name: 'static',
 *   uriTemplate: 'app://static'
 * }, async () => text('Static content'))
 *
 * // With context for auth/request access
 * server.resourceTemplate({
 *   name: 'private',
 *   uriTemplate: 'private://{id}'
 * }, async (uri, { id }, ctx) => {
 *   const user = ctx.auth;  // Access authenticated user
 *   return object(await getPrivateData(id, user));
 * })
 *
 * // Nested structure (legacy, still supported)
 * server.resourceTemplate({
 *   name: 'user-profile',
 *   resourceTemplate: {
 *     uriTemplate: 'user://{userId}/profile',
 *     mimeType: 'application/json'
 *   }
 * }, async (uri, { userId }) => object(await getUserData(userId)))
 * ```
 */

// Overloads for better type inference when callback has 2 parameters (uri, params)
export function registerResourceTemplate<HasOAuth extends boolean = false>(
  this: ResourceTemplateServerContext,
  resourceTemplateDefinition:
    | ResourceTemplateDefinition<HasOAuth>
    | ResourceTemplateDefinitionWithoutCallback
    | FlatResourceTemplateDefinition<HasOAuth>
    | FlatResourceTemplateDefinitionWithoutCallback,
  callback: (
    uri: URL,
    params: Record<string, any>
  ) => Promise<CallToolResult | ReadResourceResult | TypedCallToolResult<any>>
): ResourceTemplateServerContext;
// Overload for callback with 3 parameters (uri, params, ctx)
// eslint-disable-next-line no-redeclare
export function registerResourceTemplate<HasOAuth extends boolean = false>(
  this: ResourceTemplateServerContext,
  resourceTemplateDefinition:
    | ResourceTemplateDefinition<HasOAuth>
    | ResourceTemplateDefinitionWithoutCallback
    | FlatResourceTemplateDefinition<HasOAuth>
    | FlatResourceTemplateDefinitionWithoutCallback,
  callback: (
    uri: URL,
    params: Record<string, any>,
    ctx: EnhancedResourceContext<HasOAuth>
  ) => Promise<CallToolResult | ReadResourceResult | TypedCallToolResult<any>>
): ResourceTemplateServerContext;
// Implementation (supports all callback signatures)
// eslint-disable-next-line no-redeclare
export function registerResourceTemplate(
  this: ResourceTemplateServerContext,
  resourceTemplateDefinition:
    | ResourceTemplateDefinition
    | ResourceTemplateDefinitionWithoutCallback
    | FlatResourceTemplateDefinition
    | FlatResourceTemplateDefinitionWithoutCallback,
  callback?: ReadResourceTemplateCallback
): ResourceTemplateServerContext {
  // Determine which callback to use
  const actualCallback =
    callback ||
    (resourceTemplateDefinition as ResourceTemplateDefinition).readCallback;

  if (!actualCallback) {
    throw new Error(
      `Resource template '${resourceTemplateDefinition.name}' must have either a readCallback property or a callback parameter`
    );
  }

  // Detect structure type: flat (uriTemplate on definition) vs nested (resourceTemplate.uriTemplate)
  const isFlatStructure = "uriTemplate" in resourceTemplateDefinition;

  // Extract uriTemplate and metadata based on structure
  const uriTemplate = isFlatStructure
    ? (
        resourceTemplateDefinition as
          | FlatResourceTemplateDefinition
          | FlatResourceTemplateDefinitionWithoutCallback
      ).uriTemplate
    : (
        resourceTemplateDefinition as
          | ResourceTemplateDefinition
          | ResourceTemplateDefinitionWithoutCallback
      ).resourceTemplate.uriTemplate;

  const mimeType = isFlatStructure
    ? (
        resourceTemplateDefinition as
          | FlatResourceTemplateDefinition
          | FlatResourceTemplateDefinitionWithoutCallback
      ).mimeType
    : (
        resourceTemplateDefinition as
          | ResourceTemplateDefinition
          | ResourceTemplateDefinitionWithoutCallback
      ).resourceTemplate.mimeType;

  const templateDescription = isFlatStructure
    ? undefined
    : (
        resourceTemplateDefinition as
          | ResourceTemplateDefinition
          | ResourceTemplateDefinitionWithoutCallback
      ).resourceTemplate.description;

  // Create ResourceTemplate instance from SDK
  const template = new ResourceTemplate(uriTemplate, {
    list: undefined, // Optional: callback to list all matching resources
    complete: undefined, // Optional: callback for auto-completion
  });

  // Create metadata object with optional fields
  const metadata: any = {};
  if (resourceTemplateDefinition.title) {
    metadata.title = resourceTemplateDefinition.title;
  }
  if (resourceTemplateDefinition.description || templateDescription) {
    metadata.description =
      resourceTemplateDefinition.description || templateDescription;
  }
  if (mimeType) {
    metadata.mimeType = mimeType;
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
      const params = this.parseTemplateUri(uriTemplate, uri.toString());

      // Get the HTTP request context from AsyncLocalStorage
      const { getRequestContext, runWithContext } =
        await import("../context-storage.js");
      const { findSessionContext } =
        await import("../tools/tool-execution-helpers.js");

      const initialRequestContext = getRequestContext();

      // Find session context
      const sessions = (this as any).sessions || new Map();
      const { requestContext } = findSessionContext(
        sessions,
        initialRequestContext,
        undefined,
        undefined
      );

      // Create enhanced context (without tool-specific features)
      const enhancedContext = requestContext || {};

      // Execute callback with appropriate parameters based on callback signature
      const executeCallback = async () => {
        // Support multiple callback signatures:
        // - async () => ... (length 0)
        // - async (uri) => ... (length 1)
        // - async (uri, params) => ... (length 2)
        // - async (uri, params, ctx) => ... (length >= 3)
        if (actualCallback.length >= 3) {
          return await (actualCallback as any)(uri, params, enhancedContext);
        } else if (actualCallback.length === 2) {
          return await (actualCallback as any)(uri, params);
        } else if (actualCallback.length === 1) {
          return await (actualCallback as any)(uri);
        }
        return await (actualCallback as any)();
      };

      const result = requestContext
        ? await runWithContext(requestContext, executeCallback)
        : await executeCallback();

      // If it's already a ReadResourceResult, return as-is
      if ("contents" in result && Array.isArray(result.contents)) {
        return result as ReadResourceResult;
      }

      // Convert CallToolResult to ReadResourceResult
      return convertToolResultToResourceResult(
        uri.toString(),
        result as CallToolResult
      );
    }
  );
  this.registeredResources.push(resourceTemplateDefinition.name);
  return this;
}
