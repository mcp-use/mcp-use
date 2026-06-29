import type {
  ResourceDefinition,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  ResourceTemplateDefinition,
  EnhancedResourceContext,
} from "../types/index.js";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import type {
  ReadResourceResult,
  CallToolResult,
} from "@modelcontextprotocol/server";
import type { TypedCallToolResult } from "../utils/response-helpers.js";
import type { SessionData } from "../sessions/index.js";
import { convertToolResultToResourceResult } from "./conversion.js";
import { toResourceTemplateCompleteCallbacks } from "../utils/completion-helpers.js";

type ResourceHandlerResult = Promise<
  | CallToolResult
  | ReadResourceResult
  | TypedCallToolResult<Record<string, unknown>>
>;

// Export subscription management
export { ResourceSubscriptionManager } from "./subscriptions.js";

interface ResourceServerContext {
  nativeServer: {
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
  sessions?: Map<string, SessionData>;
}

/**
 * Define a static resource that can be accessed by clients
 *
 * @param resourceDefinition - Configuration object containing resource metadata
 * @param callback - Callback function that returns resource content
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * server.resource(
 *   { name: 'greeting', uri: 'app://greeting', title: 'Greeting' },
 *   async () => text('Hello World!')
 * )
 *
 * server.resource(
 *   { name: 'config', uri: 'config://settings' },
 *   async () => object({ theme: 'dark', version: '1.0' })
 * )
 * ```
 */
export function registerResource(
  this: ResourceServerContext,
  resourceDefinition: ResourceDefinition,
  callback: ReadResourceCallback
): ResourceServerContext {
  const explicitMimeType = resourceDefinition.mimeType;

  // Wrap the callback to support both CallToolResult and ReadResourceResult
  const wrappedCallback = async (): Promise<ReadResourceResult> => {
    const { getRequestContext, runWithContext } =
      await import("../context-storage.js");
    const { findSessionContext, createClientCapabilityChecker } =
      await import("../tools/tool-execution-helpers.js");

    const initialRequestContext = getRequestContext();
    const sessions = this.sessions ?? new Map<string, SessionData>();
    const { requestContext, session } = findSessionContext(
      sessions,
      initialRequestContext,
      undefined,
      undefined
    );

    const enhancedContext = (
      requestContext ? Object.create(requestContext) : {}
    ) as EnhancedResourceContext;
    Object.defineProperty(enhancedContext, "client", {
      value: createClientCapabilityChecker(
        session?.clientCapabilities,
        session?.clientInfo
      ),
      writable: true,
      enumerable: true,
      configurable: true,
    });

    const callbackWithOptionalContext = callback as (
      ctx?: EnhancedResourceContext
    ) => ReturnType<ReadResourceCallback>;
    const executeCallback = async () => {
      if (callback.length >= 1) {
        return await callbackWithOptionalContext(enhancedContext);
      }
      return await callbackWithOptionalContext();
    };

    const result = requestContext
      ? await runWithContext(requestContext, executeCallback)
      : await executeCallback();

    if ("contents" in result && Array.isArray(result.contents)) {
      return result as ReadResourceResult;
    }

    return convertToolResultToResourceResult(
      resourceDefinition.uri,
      result as CallToolResult
    );
  };

  const registrationMimeType = explicitMimeType || "text/plain";

  this.nativeServer.registerResource(
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

interface ResourceTemplateServerContext {
  nativeServer: {
    registerResource(
      name: string,
      template: ResourceTemplate,
      metadata: Record<string, unknown>,
      readCallback: (uri: URL) => Promise<ReadResourceResult>
    ): void;
  };
  registeredResources: string[];
  parseTemplateUri(uriTemplate: string, uri: string): Record<string, string>;
  sessions?: Map<string, SessionData>;
}

/**
 * Define a dynamic resource template with parameters
 *
 * @param resourceTemplateDefinition - Configuration object for the resource template
 * @param callback - Callback receiving URI and extracted parameters
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * server.resourceTemplate({
 *   name: 'user',
 *   uriTemplate: 'user://{id}',
 *   title: 'User Profile'
 * }, async (uri, { id }) => object(await getUserData(id)))
 * ```
 */

// Overloads for better type inference when callback has 2 parameters (uri, params)
export function registerResourceTemplate<HasOAuth extends boolean = false>(
  this: ResourceTemplateServerContext,
  resourceTemplateDefinition: ResourceTemplateDefinition<HasOAuth>,
  callback: (uri: URL, params: Record<string, string>) => ResourceHandlerResult
): ResourceTemplateServerContext;
// Overload for callback with 3 parameters (uri, params, ctx)

export function registerResourceTemplate<HasOAuth extends boolean = false>(
  this: ResourceTemplateServerContext,
  resourceTemplateDefinition: ResourceTemplateDefinition<HasOAuth>,
  callback: (
    uri: URL,
    params: Record<string, string>,
    ctx: EnhancedResourceContext<HasOAuth>
  ) => ResourceHandlerResult
): ResourceTemplateServerContext;
// Implementation (supports all callback signatures)

export function registerResourceTemplate(
  this: ResourceTemplateServerContext,
  resourceTemplateDefinition: ResourceTemplateDefinition,
  callback: ReadResourceTemplateCallback<Record<string, string>>
): ResourceTemplateServerContext {
  const {
    uriTemplate,
    mimeType,
    callbacks: resourceCallbacks,
  } = resourceTemplateDefinition;

  const template = new ResourceTemplate(uriTemplate, {
    complete: toResourceTemplateCompleteCallbacks(resourceCallbacks?.complete),
    list: undefined,
  });

  const metadata: Record<string, unknown> = {};
  if (resourceTemplateDefinition.title) {
    metadata.title = resourceTemplateDefinition.title;
  }
  if (resourceTemplateDefinition.description) {
    metadata.description = resourceTemplateDefinition.description;
  }
  if (mimeType) {
    metadata.mimeType = mimeType;
  }
  if (resourceTemplateDefinition.annotations) {
    metadata.annotations = resourceTemplateDefinition.annotations;
  }

  this.nativeServer.registerResource(
    resourceTemplateDefinition.name,
    template,
    metadata,
    async (uri: URL) => {
      const params = this.parseTemplateUri(uriTemplate, uri.toString());

      const { getRequestContext, runWithContext } =
        await import("../context-storage.js");
      const { findSessionContext } =
        await import("../tools/tool-execution-helpers.js");

      const initialRequestContext = getRequestContext();
      const sessions = this.sessions ?? new Map<string, SessionData>();
      const { requestContext } = findSessionContext(
        sessions,
        initialRequestContext,
        undefined,
        undefined
      );

      const enhancedContext = (requestContext || {}) as EnhancedResourceContext;

      const callbackWithOptionalArgs = callback as (
        uri?: URL,
        params?: Record<string, string>,
        ctx?: EnhancedResourceContext
      ) => ReturnType<ReadResourceTemplateCallback>;
      const executeCallback = async () => {
        if (callback.length >= 3) {
          return await callbackWithOptionalArgs(uri, params, enhancedContext);
        } else if (callback.length === 2) {
          return await callbackWithOptionalArgs(uri, params);
        } else if (callback.length === 1) {
          return await callbackWithOptionalArgs(uri);
        }
        return await callbackWithOptionalArgs();
      };

      const result = requestContext
        ? await runWithContext(requestContext, executeCallback)
        : await executeCallback();

      if ("contents" in result && Array.isArray(result.contents)) {
        return result as ReadResourceResult;
      }

      return convertToolResultToResourceResult(
        uri.toString(),
        result as CallToolResult
      );
    }
  );
  this.registeredResources.push(resourceTemplateDefinition.name);
  return this;
}
