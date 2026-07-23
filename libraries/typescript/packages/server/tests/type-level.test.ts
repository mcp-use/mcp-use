/**
 * Compile-time contract tests for the result-type model. vitest executes this
 * file but does not typecheck it — the real assertions are the
 * `@ts-expect-error` directives and `expectTypeOf` calls, enforced by
 * `pnpm typecheck` (tsc over tsconfig.test.json). An unused `@ts-expect-error`
 * fails that typecheck, so a regression in strictness cannot land silently.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type {
  Annotations as SdkAnnotations,
  MetaObject as SdkMetaObject,
  Prompt as SdkPrompt,
  Resource as SdkResource,
  Tool as SdkTool,
  ToolAnnotations as SdkToolAnnotations,
} from "@modelcontextprotocol/server";

import {
  createMcpEventListenerEntry,
  createMcpMiddlewareEntry,
  MCPServer,
  text,
} from "../src/index.js";
import type {
  Annotations,
  CallToolResult,
  Icon,
  InputRequiredResult,
  LandingPageOptions,
  MetaObject,
  GetPromptResult,
  ProxyHttpConfig,
  ProxyServerConfig,
  ReadResourceResult,
  ResourceDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
  ToolAnnotations,
  ToolDefinition,
  ToolResult,
} from "../src/index.js";
import { useViewState } from "../src/react/index.js";
import type { FileMetadata, UseFilesResult } from "../src/react/index.js";

describe("server branding config", () => {
  it("uses the official MCP Icon shape", () => {
    const icon: Icon = {
      src: "brand/icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["any"],
      theme: "dark",
    };
    const config: ServerConfig = {
      name: "branding-types",
      version: "1.0.0",
      websiteUrl: "https://example.com",
      favicon: "brand/favicon.ico",
      icons: [icon],
    };
    expectTypeOf(config.icons).toEqualTypeOf<Icon[] | undefined>();

    const invalid: ServerConfig = {
      name: "invalid-branding-types",
      version: "1.0.0",
      icons: [
        {
          src: "icon.svg",
          // @ts-expect-error — theme is the official light/dark union
          theme: "auto",
        },
      ],
    };
    expect([config, invalid]).toBeDefined();
  });
});

const outputSchema = z.object({ answer: z.number() });

describe("definition metadata types", () => {
  it("re-exports the official SDK annotation and metadata contracts", () => {
    expectTypeOf<Annotations>().toEqualTypeOf<SdkAnnotations>();
    expectTypeOf<ToolAnnotations>().toEqualTypeOf<SdkToolAnnotations>();
    expectTypeOf<MetaObject>().toEqualTypeOf<SdkMetaObject>();
  });

  it("accepts official metadata shapes on all public descriptors", () => {
    const tool: ToolDefinition = {
      name: "metadata-tool",
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { "example.com/tool": { enabled: true } },
    };
    const resource: ResourceDefinition = {
      name: "metadata-resource",
      uri: "metadata://resource",
      annotations: {
        audience: ["user", "assistant"],
        priority: 0.5,
        lastModified: "2026-07-17T12:00:00Z",
      },
      _meta: { "example.com/resource": [null, false, 0, ""] },
    };
    const template: ResourceTemplateDefinition = {
      name: "metadata-template",
      uriTemplate: "metadata://{id}",
      annotations: { audience: ["assistant"] },
      _meta: { "example.com/template": { version: 1 } },
    };
    expect([tool, resource, template]).toBeDefined();
  });

  it("rejects shapes excluded by the official SDK contracts", () => {
    const tool: ToolDefinition = {
      name: "invalid-tool",
      annotations: {
        // @ts-expect-error — resource priority is not a ToolAnnotations field
        priority: 0.5,
      },
      // @ts-expect-error — descriptor _meta must be a string-keyed object
      _meta: "not-an-object",
    };
    const resource: ResourceDefinition = {
      name: "invalid-resource",
      uri: "invalid://resource",
      annotations: {
        // @ts-expect-error — general Annotations audience uses MCP roles
        audience: ["model"],
        // @ts-expect-error — lastModified is an RFC 3339 string
        lastModified: 123,
      },
    };
    const template: ResourceTemplateDefinition = {
      name: "invalid-template",
      uriTemplate: "invalid://{id}",
      // @ts-expect-error — arrays are not MetaObject records
      _meta: [],
    };
    expect([tool, resource, template]).toBeDefined();
  });
});

describe("useFiles public types", () => {
  it("exposes the narrow file upload and download contract", () => {
    expectTypeOf<FileMetadata>().toEqualTypeOf<{ fileId: string }>();
    expectTypeOf<UseFilesResult["upload"]>().toEqualTypeOf<
      (file: File) => Promise<FileMetadata>
    >();
    expectTypeOf<UseFilesResult["getDownloadUrl"]>().toEqualTypeOf<
      (file: FileMetadata) => Promise<{ downloadUrl: string }>
    >();
    expect(true).toBe(true);
  });
});

describe("useViewState public types", () => {
  it("requires object state and exposes a synchronous useState-style setter", () => {
    if (false) {
      const [state, setState] = useViewState({ count: 0 });
      expectTypeOf(state).toEqualTypeOf<{ count: number }>();
      expectTypeOf(setState).returns.toBeVoid();
      setState({ count: 1 });
      setState((previous) => ({ count: previous.count + 1 }));

      // @ts-expect-error — view state must be an object, not an array
      useViewState(["first", "second"]);
      // @ts-expect-error — a default object is required
      useViewState();
    }
    expect(true).toBe(true);
  });
});

describe("landing page public types", () => {
  it("accepts the boolean ServerConfig option and object generator options", () => {
    const config: ServerConfig = {
      name: "types",
      version: "0.0.0",
      publicLandingPage: true,
    };
    const page: LandingPageOptions = {
      name: "types",
      version: "0.0.0",
      url: "https://example.test/mcp",
      tools: [{ name: "ping", description: "Return pong." }],
    };
    const invalid: ServerConfig = {
      name: "types",
      version: "0.0.0",
      // @ts-expect-error — publicLandingPage is a boolean option
      publicLandingPage: "yes",
    };
    expect([config, page, invalid]).toBeDefined();
  });
});

describe("ToolResult resolution", () => {
  it("accepts regular and input-required results without an output type", () => {
    expectTypeOf<ToolResult>().toEqualTypeOf<
      CallToolResult | InputRequiredResult
    >();
  });

  it("requires matching structuredContent or isError when one is", () => {
    // Assignment-position checks (expectTypeOf's match helpers choke on the
    // SDK result type's index signature).
    const structured: ToolResult<{ answer: number }> = {
      content: [{ type: "text", text: "42" }],
      structuredContent: { answer: 42 },
    };
    const error: ToolResult<{ answer: number }> = {
      content: [{ type: "text", text: "boom" }],
      isError: true,
    };
    // @ts-expect-error — content-only results need structuredContent or isError
    const contentOnly: ToolResult<{ answer: number }> = {
      content: [{ type: "text", text: "hi" }],
    };
    expect([structured, error, contentOnly]).toBeDefined(); // compile-time only
  });
});

describe("proxy public types", () => {
  it("exposes only caller-authenticated HTTP config", () => {
    const config: ProxyHttpConfig = {
      url: "https://example.com/mcp",
      authToken: "caller-managed-token",
    };
    expectTypeOf(config).toMatchTypeOf<ProxyServerConfig>();
    expectTypeOf<
      "command" extends keyof ProxyServerConfig ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "oauth" extends keyof ProxyServerConfig ? true : false
    >().toEqualTypeOf<false>();

    if (false) {
      const server = new MCPServer({ name: "types", version: "0.0.0" });
      // @ts-expect-error — stdio is not part of the proxy surface
      void server.proxy({ local: { command: "node", args: ["server.mjs"] } });
      // @ts-expect-error — proxy OAuth/browser acquisition is intentionally absent
      void server.proxy({ remote: { url: config.url, oauth: false } });
    }

    expect(config.url).toBe("https://example.com/mcp");
  });
});

describe("tool registration return-position checks", () => {
  it("accepts structured and error results for tools with an outputSchema", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool({ name: "structured", outputSchema }, async () => ({
      content: [{ type: "text", text: "42" }],
      structuredContent: { answer: 42 },
    }));
    server.tool({ name: "err", outputSchema }, async () => ({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    }));
    server.tool({ name: "interactive", outputSchema }, async (_params, ctx) => {
      const answer = await ctx.elicit(
        "answer",
        "Provide an answer",
        z.object({ answer: z.number() })
      );
      if (answer.status === "required") return answer.result;
      if (answer.status !== "accept") {
        return {
          content: [{ type: "text", text: answer.status }],
          isError: true,
        };
      }
      expectTypeOf(answer.data).toEqualTypeOf<{ answer: number }>();
      return {
        content: [{ type: "text", text: String(answer.data.answer) }],
        structuredContent: answer.data,
      };
    });
    expect(true).toBe(true); // assertions above are compile-time
  });

  it("rejects content-only and mistyped results when an outputSchema is declared", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool(
      { name: "content-only", outputSchema },
      // @ts-expect-error — no structuredContent; the SDK would reject this at call time
      async () => ({ content: [{ type: "text", text: "no payload" }] })
    );
    server.tool(
      { name: "wrong-shape", outputSchema },
      // @ts-expect-error — structuredContent must match the outputSchema
      async () => ({
        content: [{ type: "text", text: "not a number" }],
        structuredContent: { answer: "not a number" },
      })
    );
    expect(true).toBe(true); // assertions above are compile-time
  });

  it("allows non-object outputSchema roots (2026-07-28 wire)", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool(
      { name: "array-root", outputSchema: z.array(z.number()) },
      async () => ({ content: [], structuredContent: [1, 2, 3] })
    );
    server.tool(
      { name: "primitive-root", outputSchema: z.number() },
      async () => ({ content: [], structuredContent: 42 })
    );
    server.tool(
      { name: "mismatched-root", outputSchema: z.array(z.number()) },
      // @ts-expect-error — structuredContent must match the array schema
      async () => ({ content: [], structuredContent: { answer: 42 } })
    );
    expect(true).toBe(true); // assertions above are compile-time
  });

  it("accepts any CallToolResult when no outputSchema is declared", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool({ name: "free-text" }, async () => ({
      content: [{ type: "text", text: "hi" }],
    }));
    server.tool({ name: "free-structured" }, async () => ({
      content: [{ type: "text", text: "{}" }],
      structuredContent: { anything: true },
    }));
    server.tool({ name: "free-error" }, async () => ({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    }));
    expect(true).toBe(true); // assertions above are compile-time
  });
});

describe("elicitation context", () => {
  it("infers form data and supports URL mode", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool({ name: "elicit-types" }, async (_params, ctx) => {
      const form = await ctx.elicit(
        "profile",
        "Your profile",
        z.object({ name: z.string() })
      );
      const url = await ctx.elicit(
        "signin",
        "Sign in",
        "https://example.com/sign-in"
      );
      if (form.status === "accept") {
        expectTypeOf(form.data).toEqualTypeOf<{ name: string }>();
      }
      expect(url).toBeDefined();
      return form.status === "required"
        ? form.result
        : { content: [{ type: "text", text: form.status }] };
    });
    expect(true).toBe(true);
  });
});

describe("template variable inference", () => {
  it("extracts operators, explode/prefix modifiers, and comma lists", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.resourceTemplate(
      { name: "multi", uriTemplate: "files://{dir}/{file}{.ext}{?q,limit*}" },
      async (uri, params) => {
        expectTypeOf(params).toEqualTypeOf<{
          dir: string | string[];
          file: string | string[];
          ext: string | string[];
          q: string | string[];
          limit: string | string[];
        }>();
        return { contents: [{ uri: uri.href, text: "ok" }] };
      }
    );
    expect(true).toBe(true); // assertions above are compile-time
  });

  it("infers completion keys and the official callback context", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.resourceTemplate(
      {
        name: "completed",
        uriTemplate: "repo://{owner}/{repo}{?ref}",
        complete: {
          owner: ["modelcontextprotocol"] as const,
          repo: async (value, context) => {
            expectTypeOf(value).toEqualTypeOf<string>();
            expectTypeOf(context?.arguments).toEqualTypeOf<
              Record<string, string> | undefined
            >();
            // @ts-expect-error The pinned SDK does not expose cancellation here.
            void context?.signal;
            // @ts-expect-error The pinned SDK does not expose request auth here.
            void context?.auth;
            return [value];
          },
          ref: (value) => [value],
        },
      },
      async (uri) => ({ contents: [{ uri: uri.href, text: "ok" }] })
    );

    server.resourceTemplate(
      {
        name: "invalid-completion-key",
        uriTemplate: "repo://{owner}/{repo}",
        complete: {
          // @ts-expect-error "branch" is not a variable in the literal template.
          branch: ["main"],
        },
      },
      async (uri) => ({ contents: [{ uri: uri.href, text: "ok" }] })
    );
    expect(true).toBe(true);
  });
});

describe("ToolRef inference", () => {
  it("carries literal name and inferred input/output from zod schemas", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    const ref = server.tool(
      {
        name: "search-fruits",
        inputSchema: z.object({ query: z.string().optional() }),
        outputSchema: z.object({
          query: z.string(),
          items: z.array(z.object({ id: z.string() })),
        }),
      },
      async () => ({
        content: [{ type: "text", text: "ok" }],
        structuredContent: { query: "", items: [] },
      })
    );
    expectTypeOf(ref.name).toEqualTypeOf<"search-fruits">();
    expect(ref.name).toBe("search-fruits");
  });

  it("infers input from the schema alias when inputSchema is omitted", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    const ref = server.tool(
      {
        name: "alias-input",
        schema: z.object({ id: z.string() }),
      },
      async ({ id }) => ({
        content: [{ type: "text", text: id }],
      })
    );
    expectTypeOf(ref.name).toEqualTypeOf<"alias-input">();
    expect(ref.name).toBe("alias-input");
  });
});

describe("view-bound tool return-position checks", () => {
  const outputSchema = z.object({ answer: z.number() });

  it("accepts matching structuredContent and is assignable to ToolResult", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool({ name: "with-view", outputSchema }, async () => ({
      content: [{ type: "text", text: "forty-two" }],
      structuredContent: { answer: 42 },
    }));
    const result: ToolResult<{ answer: number }> = {
      structuredContent: { answer: 1 },
      content: [{ type: "text", text: "one" }],
    };
    expect(result.structuredContent).toEqual({ answer: 1 });
  });

  it("rejects structuredContent that disagrees with the tool outputSchema", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.tool(
      { name: "mismatch", outputSchema },
      // @ts-expect-error — structuredContent must match outputSchema at the return position
      async () => ({
        content: [{ type: "text", text: "bad" }],
        structuredContent: { answer: "not a number" },
      })
    );
    expect(true).toBe(true);
  });
});

describe("MCP middleware type narrowing", () => {
  it("exports typed entry adapters from the package root", () => {
    const middleware = createMcpMiddlewareEntry(
      "mcp:tools/list",
      async (ctx, next) => {
        expectTypeOf(ctx.params.cursor).toEqualTypeOf<string | undefined>();
        const tools = await next();
        expectTypeOf(tools).toEqualTypeOf<SdkTool[]>();
        return tools;
      }
    );
    const listener = createMcpEventListenerEntry(
      "mcp:tools/call:complete",
      (ctx, result) => {
        expectTypeOf(ctx.params.name).toBeString();
        expectTypeOf(result).toEqualTypeOf<
          CallToolResult | InputRequiredResult
        >();
      }
    );

    expect(middleware.pattern).toBe("tools/list");
    expect(listener).toMatchObject({
      pattern: "tools/call",
      phase: "complete",
    });
  });

  it("narrows ctx.params for tools/call middleware", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.use("mcp:tools/call", async (ctx, next) => {
      expectTypeOf(ctx.params.name).toBeString();
      expectTypeOf(ctx.params.arguments).toEqualTypeOf<
        Record<string, unknown> | undefined
      >();
      return next();
    });
    expect(server).toBeDefined();
  });

  it("types list middleware as item-array transformations", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.use("mcp:tools/list", async (ctx, next) => {
      expectTypeOf(ctx.params.cursor).toEqualTypeOf<string | undefined>();
      const tools = await next();
      expectTypeOf(tools).toEqualTypeOf<SdkTool[]>();
      return tools.filter((tool) => !tool.name.startsWith("_"));
    });
    server.use("mcp:resources/list", async (_ctx, next) => {
      const resources = await next();
      expectTypeOf(resources).toEqualTypeOf<SdkResource[]>();
      return resources;
    });
    server.use("mcp:prompts/list", async (_ctx, next) => {
      const prompts = await next();
      expectTypeOf(prompts).toEqualTypeOf<SdkPrompt[]>();
      return prompts;
    });
    expect(server).toBeDefined();
  });

  it("types handler results including input-required results", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.use("mcp:resources/read", async (_ctx, next) => {
      const result = await next();
      expectTypeOf(result).toEqualTypeOf<
        ReadResourceResult | InputRequiredResult
      >();
      return result;
    });
    server.use("mcp:prompts/get", async (_ctx, next) => {
      const result = await next();
      expectTypeOf(result).toEqualTypeOf<
        GetPromptResult | InputRequiredResult
      >();
      return result;
    });
    expect(server).toBeDefined();
  });

  it("keeps global middleware type-preserving", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.use("mcp:*", async (ctx, next) => {
      expectTypeOf(ctx.method).toMatchTypeOf<string>();
      ctx.state.set("observed", true);
      return next();
    });
    if (false) {
      // @ts-expect-error — category wildcards are observer-only patterns
      server.use("mcp:tools/*", async () => undefined);
    }
    server.on("mcp:tools/*", (ctx) => {
      expectTypeOf(ctx.method).toEqualTypeOf<"tools/call" | "tools/list">();
    });
    server.on("mcp:tools/*:complete", (ctx, result) => {
      expectTypeOf(ctx.method).toMatchTypeOf<"tools/call" | "tools/list">();
      void result;
    });
    expect(server).toBeDefined();
  });

  it("rejects results belonging to a different method", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    // @ts-expect-error — tools/list middleware must return Tool[]
    server.use("mcp:tools/list", async () => ({ content: [] }));
    // @ts-expect-error — a wildcard cannot return one method's result
    server.use("mcp:*", async () => [] as SdkTool[]);
    expect(server).toBeDefined();
  });

  it("types complete observer results by method", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.on("mcp:tools/list:complete", (_ctx, tools) => {
      expectTypeOf(tools).toEqualTypeOf<SdkTool[]>();
    });
    server.on("mcp:tools/call:complete", (_ctx, result) => {
      expectTypeOf(result).toEqualTypeOf<
        CallToolResult | InputRequiredResult
      >();
    });
    expect(server).toBeDefined();
  });
});

describe("deprecated helper returns on resource/prompt callbacks", () => {
  it("accepts helper-shaped CallToolResult and raw envelopes", () => {
    const server = new MCPServer({ name: "types", version: "0.0.0" });
    server.resource({ name: "greeting", uri: "app://greeting" }, async () =>
      text("hello")
    );
    server.resource({ name: "raw", uri: "app://raw" }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: "raw" }],
    }));
    server.prompt({ name: "review" }, async () => text("please review"));
    server.prompt({ name: "raw-prompt" }, async () => ({
      messages: [
        { role: "user", content: { type: "text", text: "please review" } },
      ],
    }));
    expect(server).toBeDefined();
  });
});
