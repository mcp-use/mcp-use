/**
 * MCP Conformance Test Server (TypeScript)
 *
 * Implements all supported MCP features for the inspector conformance suite.
 * Uses exact tool/resource/prompt names expected by e2e tests.
 *
 * Default-export the server; `mcp-use dev` / `build` / `start` own the socket.
 */
import {
  acceptedContent,
  completable,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  MCPServer,
} from "mcp-use";
import { z } from "zod";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const RED_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const SILENT_WAV_BASE64 =
  "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAABAAgAZGF0YQIAAACA";

const STATIC_BINARY_BLOB = "AAECA//+/Q==";

const weatherOutputSchema = z.object({
  city: z.string(),
  temperature: z.number(),
  conditions: z.string(),
  humidity: z.number(),
  windSpeed: z.number(),
});

const conformanceRequestState = createRequestStateCodec<{
  scenario: string;
  round: number;
}>({
  // This is a deterministic fixture key, not an application secret. Its only
  // purpose is to exercise the requestState integrity contract.
  key: new Uint8Array(32).fill(17),
  ttlSeconds: 60,
});

const nameSchema = z.object({ name: z.string() });
const confirmationSchema = z.object({ ok: z.boolean() });
const colorSchema = z.object({ color: z.string() });

const jsonSchema202012ToolSchema = z
  .object({
    name: z.string().optional(),
    address: z.object({ street: z.string(), city: z.string() }).optional(),
    contactMethod: z.enum(["phone", "email"]).optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
  })
  .meta({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: {
      address: {
        $anchor: "addressDef",
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
        },
      },
    },
    allOf: [{ anyOf: [{ required: ["phone"] }, { required: ["email"] }] }],
    if: {
      properties: { contactMethod: { const: "phone" } },
      required: ["contactMethod"],
    },
    then: { required: ["phone"] },
    else: { required: ["email"] },
    additionalProperties: false,
  });

const server = new MCPServer({
  name: "ConformanceTestServer",
  version: "1.0.0",
  description:
    "MCP Conformance Test Server implementing all supported features.",
  websiteUrl: "https://mcp-use.com",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["any"],
    },
  ],
  logging: { level: "debug" },
  requestState: { verify: conformanceRequestState.verify },
});

// =============================================================================
// TOOLS
// =============================================================================

server.tool(
  {
    name: "test_simple_text",
    description: "A simple tool that returns text content",
    inputSchema: z.object({
      message: z.string().optional(),
    }),
  },
  async ({ message = "Hello, World!" }) => ({
    content: [{ type: "text", text: `Echo: ${message}` }],
  })
);

server.tool(
  {
    name: "test_typed_arguments",
    description:
      "Validates argument typing for boolean, array, and object parameters",
    inputSchema: z.object({
      flag: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      config: z
        .object({
          mode: z.string(),
          count: z.number(),
        })
        .optional(),
    }),
  },
  async ({
    flag = false,
    tags = [],
    config = { mode: "default", count: 0 },
  }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          flagType: typeof flag,
          tagsIsArray: Array.isArray(tags),
          configIsObject:
            typeof config === "object" &&
            config !== null &&
            !Array.isArray(config),
          values: { flag, tags, config },
        }),
      },
    ],
  })
);

server.tool(
  {
    name: "test_image_content",
    description: "A tool that returns image content",
  },
  async () => ({
    content: [{ type: "image", data: RED_PIXEL_PNG, mimeType: "image/png" }],
  })
);

server.tool(
  {
    name: "test_audio_content",
    description: "A tool that returns audio content",
  },
  async () => ({
    content: [
      { type: "audio", data: SILENT_WAV_BASE64, mimeType: "audio/wav" },
    ],
  })
);

server.tool(
  {
    name: "test_embedded_resource",
    description: "A tool that returns an embedded resource",
  },
  async () => ({
    content: [
      {
        type: "resource",
        resource: {
          uri: "test://embedded",
          mimeType: "text/plain",
          text: "This is embedded resource content",
        },
      },
    ],
  })
);

server.tool(
  {
    name: "test_multiple_content_types",
    description: "A tool that returns mixed content (text + image + resource)",
  },
  async () => ({
    content: [
      { type: "text", text: "Multiple content types test:" },
      { type: "image", data: RED_PIXEL_PNG, mimeType: "image/png" },
      {
        type: "resource",
        resource: {
          uri: "test://mixed-content-resource",
          mimeType: "application/json",
          text: JSON.stringify({ test: "data", value: 123 }),
        },
      },
    ],
  })
);

server.tool(
  {
    name: "test_tool_with_logging",
    description: "A tool that sends log messages during execution",
  },
  async (_input, ctx) => {
    await ctx.sendLog("info", "Tool execution started");
    await sleep(50);
    await ctx.sendLog("info", "Tool processing data");
    await sleep(50);
    await ctx.sendLog("info", "Tool execution completed");
    return {
      content: [
        { type: "text", text: "Tool execution completed with logging" },
      ],
    };
  }
);

server.tool(
  {
    name: "test_tool_with_progress",
    description: "A tool that reports progress",
    inputSchema: z.object({
      steps: z.number().optional(),
    }),
  },
  async ({ steps = 5 }, ctx) => {
    for (let i = 0; i < steps; i++) {
      await ctx.reportProgress(i + 1, steps, `Step ${i + 1} of ${steps}`);
      await sleep(10);
    }
    return {
      content: [{ type: "text", text: `Completed ${steps} steps` }],
    };
  }
);

server.tool(
  {
    name: "test_sampling",
    description: "A tool that uses client LLM sampling",
    inputSchema: z.object({
      prompt: z.string().optional(),
    }),
  },
  async ({ prompt = "Hello" }, ctx) => {
    const response = inputResponse(ctx.inputResponses, "sample");
    if (response.kind === "missing") {
      return inputRequired({
        inputRequests: {
          sample: inputRequired.createMessage({
            messages: [
              { role: "user", content: { type: "text", text: prompt } },
            ],
            maxTokens: 100,
          }),
        },
      });
    }
    if (response.kind === "sampling") {
      const blocks = Array.isArray(response.result.content)
        ? response.result.content
        : [response.result.content];
      const text = blocks
        .map((block) =>
          block.type === "text" ? block.text : JSON.stringify(block)
        )
        .join("\n");
      return { content: [{ type: "text", text: text || "No response" }] };
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Sampling error: Expected a sampling response, got ${response.kind}`,
        },
      ],
    };
  }
);

server.tool(
  {
    name: "test_elicitation",
    description: "A tool that uses elicitation to get user input",
  },
  async (_input, ctx) => {
    const schema = z.object({
      name: z.string().default("Anonymous"),
      age: z.number().default(0),
    });
    // A stateless callback starts from the top for both initial calls and
    // retries, so handle decline/cancel before deciding input is still needed.
    const response = inputResponse(ctx.inputResponses, "elicitation");
    if (response.kind === "elicit" && response.action !== "accept") {
      return {
        content: [
          {
            type: "text",
            text:
              response.action === "decline"
                ? "User declined"
                : "Operation cancelled",
          },
        ],
      };
    }
    const form = acceptedContent(ctx.inputResponses, "elicitation", schema);
    // Missing or invalid accepted data means this round must request it.
    if (form === undefined) {
      return inputRequired({
        inputRequests: {
          elicitation: inputRequired.elicit({
            message: "Please provide your information",
            requestedSchema: schema,
          }),
        },
      });
    }
    // Produce the successful result only from accepted, validated input.
    return {
      content: [
        {
          type: "text",
          text: `Received: ${form.name}, age ${form.age}`,
        },
      ],
    };
  }
);

server.tool(
  {
    name: "test_elicitation_sep1034_defaults",
    description:
      "A tool that uses elicitation with default values for all primitive types (SEP-1034)",
  },
  async (_input, ctx) => {
    const schema = z.object({
      name: z.string().default("John Doe"),
      age: z.number().int().default(30),
      score: z.number().default(95.5),
      status: z.enum(["active", "inactive", "pending"]).default("active"),
      verified: z.boolean().default(true),
    });
    // Each invocation may be the initial call or a retry; inspect this round's
    // response before falling back to input_required.
    const response = inputResponse(ctx.inputResponses, "elicitation-sep1034");
    if (response.kind === "elicit" && response.action !== "accept") {
      return {
        content: [
          {
            type: "text",
            text: `Elicitation completed: action=${response.action}`,
          },
        ],
      };
    }
    const form = acceptedContent(
      ctx.inputResponses,
      "elicitation-sep1034",
      schema
    );
    // Re-request when accepted content is absent or fails schema validation.
    if (form === undefined) {
      return inputRequired({
        inputRequests: {
          "elicitation-sep1034": inputRequired.elicit({
            message: "Please provide your information",
            requestedSchema: schema,
          }),
        },
      });
    }
    return {
      content: [
        {
          type: "text",
          text: `Elicitation completed: action=accept, content=${JSON.stringify(form)}`,
        },
      ],
    };
  }
);

server.tool(
  {
    name: "test_elicitation_sep1330_enums",
    description:
      "A tool that uses elicitation with all 5 enum variants (SEP-1330)",
  },
  async (_input, ctx) => {
    // ponytail: z.enum stand-ins for v1 enumSchema variants; titles/names not preserved
    const schema = z.object({
      untitledSingle: z.enum(["option1", "option2", "option3"]),
      titledSingle: z.enum(["value1", "value2", "value3"]),
      legacyEnum: z.enum(["opt1", "opt2", "opt3"]),
      untitledMulti: z.array(z.enum(["option1", "option2", "option3"])),
      titledMulti: z.array(z.enum(["value1", "value2", "value3"])),
    });
    // Stateless retries re-enter here, so consume any terminal response before
    // deciding that this round still needs user input.
    const response = inputResponse(ctx.inputResponses, "elicitation-sep1330");
    if (response.kind === "elicit" && response.action !== "accept") {
      return {
        content: [
          {
            type: "text",
            text: `Elicitation completed: action=${response.action}`,
          },
        ],
      };
    }
    const form = acceptedContent(
      ctx.inputResponses,
      "elicitation-sep1330",
      schema
    );
    // Only missing or schema-invalid accepted data should request another round.
    if (form === undefined) {
      return inputRequired({
        inputRequests: {
          "elicitation-sep1330": inputRequired.elicit({
            message: "Please choose your options",
            requestedSchema: schema,
          }),
        },
      });
    }
    return {
      content: [
        {
          type: "text",
          text: `Elicitation completed: action=accept, content=${JSON.stringify(form)}`,
        },
      ],
    };
  }
);

server.tool(
  {
    name: "test_error_handling",
    description: "A tool that raises an error for testing error handling",
  },
  async () => ({
    isError: true,
    content: [
      { type: "text", text: "This is an intentional error for testing" },
    ],
  })
);

server.tool(
  {
    name: "test_record_schema",
    description:
      "Tests z.record() schema roundtrip with additionalProperties and descriptions",
    inputSchema: z.object({
      files: z
        .record(z.string(), z.string())
        .describe(
          "REQUIRED. A {path: code} object mapping file paths to source code strings."
        ),
      entryFile: z
        .string()
        .optional()
        .describe('Entry file path (default: "/src/Video.tsx").'),
      title: z.string().optional().describe("Title shown in the video player"),
      durationInFrames: z
        .number()
        .optional()
        .describe("Total duration in frames (default: 150)"),
      fps: z.number().optional().describe("Frames per second (default: 30)"),
      width: z.number().optional().describe("Width in pixels (default: 1920)"),
      height: z
        .number()
        .optional()
        .describe("Height in pixels (default: 1080)"),
    }),
  },
  async (params) => ({
    content: [
      {
        type: "text",
        text: `Received ${Object.keys(params.files ?? {}).length} files`,
      },
    ],
  })
);

// =============================================================================
// STATELESS (2026-07-28) CONFORMANCE FIXTURES
// =============================================================================

server.tool(
  {
    name: "json_schema_2020_12_tool",
    description: "Tool with JSON Schema 2020-12 features",
    inputSchema: jsonSchema202012ToolSchema,
  },
  async () => ({ content: [{ type: "text", text: "JSON Schema accepted" }] })
);

server.tool(
  {
    name: "test_custom_header",
    description: "Exercises the x-mcp-header transport parameter fixture",
    inputSchema: z.object({
      value: z.string().meta({ "x-mcp-header": "Conformance-Value" }),
    }),
  },
  async ({ value }) => ({
    content: [{ type: "text", text: `Custom header value: ${value}` }],
  })
);

server.tool(
  {
    name: "test_input_required_result_elicitation",
    description:
      "Requests and validates an elicitation response across retries",
  },
  async (_input, ctx) => {
    const form = acceptedContent(ctx.inputResponses, "user_name", nameSchema);
    if (form === undefined) {
      return inputRequired({
        inputRequests: {
          user_name: inputRequired.elicit({
            message: "What is your name?",
            requestedSchema: nameSchema,
          }),
        },
      });
    }
    return { content: [{ type: "text", text: `Hello, ${form.name}!` }] };
  }
);

server.tool(
  {
    name: "test_input_required_result_sampling",
    description: "Requests a sampling response through an input_required retry",
  },
  async (_input, ctx) => {
    const response = inputResponse(ctx.inputResponses, "capital_question");
    if (response.kind !== "sampling") {
      return inputRequired({
        inputRequests: {
          capital_question: inputRequired.createMessage({
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: "What is the capital of France?",
                },
              },
            ],
            maxTokens: 100,
          }),
        },
      });
    }
    const content = Array.isArray(response.result.content)
      ? response.result.content
      : [response.result.content];
    const text = content
      .map((block) =>
        block.type === "text" ? block.text : JSON.stringify(block)
      )
      .join("\n");
    return {
      content: [{ type: "text", text: text || "No sampling response" }],
    };
  }
);

server.tool(
  {
    name: "test_input_required_result_list_roots",
    description: "Requests the client's roots through an input_required retry",
  },
  async (_input, ctx) => {
    const response = inputResponse(ctx.inputResponses, "client_roots");
    if (response.kind !== "roots") {
      return inputRequired({
        inputRequests: { client_roots: inputRequired.listRoots() },
      });
    }
    return {
      content: [
        {
          type: "text",
          text: `Received ${response.roots.length} client root(s)`,
        },
      ],
    };
  }
);

server.tool(
  {
    name: "test_input_required_result_request_state",
    description: "Verifies integrity-protected requestState round-tripping",
  },
  async (_input, ctx) => {
    const state = ctx.requestState<{ scenario: string; round: number }>();
    const confirmation = acceptedContent(
      ctx.inputResponses,
      "confirm",
      confirmationSchema
    );
    if (
      state?.scenario !== "request-state" ||
      state.round !== 1 ||
      confirmation === undefined
    ) {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: "Please confirm",
            requestedSchema: confirmationSchema,
          }),
        },
        requestState: await conformanceRequestState.mint({
          scenario: "request-state",
          round: 1,
        }),
      });
    }
    return { content: [{ type: "text", text: "state-ok" }] };
  }
);

server.tool(
  {
    name: "test_input_required_result_multiple_inputs",
    description: "Requests elicitation, sampling, and roots in one retry",
  },
  async (_input, ctx) => {
    const name = acceptedContent(ctx.inputResponses, "user_name", nameSchema);
    const sample = inputResponse(ctx.inputResponses, "greeting");
    const roots = inputResponse(ctx.inputResponses, "client_roots");
    const state = ctx.requestState<{ scenario: string; round: number }>();
    if (
      state?.scenario !== "multiple-inputs" ||
      name === undefined ||
      sample.kind !== "sampling" ||
      roots.kind !== "roots"
    ) {
      return inputRequired({
        inputRequests: {
          user_name: inputRequired.elicit({
            message: "What is your name?",
            requestedSchema: nameSchema,
          }),
          greeting: inputRequired.createMessage({
            messages: [
              {
                role: "user",
                content: { type: "text", text: "Generate a greeting" },
              },
            ],
            maxTokens: 50,
          }),
          client_roots: inputRequired.listRoots(),
        },
        requestState: await conformanceRequestState.mint({
          scenario: "multiple-inputs",
          round: 1,
        }),
      });
    }
    return { content: [{ type: "text", text: `Hello, ${name.name}!` }] };
  }
);

server.tool(
  {
    name: "test_input_required_result_multi_round",
    description: "Runs a two-stage input_required elicitation flow",
  },
  async (_input, ctx) => {
    const state = ctx.requestState<{ scenario: string; round: number }>();
    if (state?.scenario !== "multi-round" || state.round === 1) {
      const name = acceptedContent(ctx.inputResponses, "step1", nameSchema);
      if (name !== undefined && state?.round === 1) {
        return inputRequired({
          inputRequests: {
            step2: inputRequired.elicit({
              message: "Step 2: What is your favorite color?",
              requestedSchema: colorSchema,
            }),
          },
          requestState: await conformanceRequestState.mint({
            scenario: "multi-round",
            round: 2,
          }),
        });
      }
      return inputRequired({
        inputRequests: {
          step1: inputRequired.elicit({
            message: "Step 1: What is your name?",
            requestedSchema: nameSchema,
          }),
        },
        requestState: await conformanceRequestState.mint({
          scenario: "multi-round",
          round: 1,
        }),
      });
    }
    const color = acceptedContent(ctx.inputResponses, "step2", colorSchema);
    if (color === undefined) {
      return inputRequired({
        inputRequests: {
          step2: inputRequired.elicit({
            message: "Step 2: What is your favorite color?",
            requestedSchema: colorSchema,
          }),
        },
        requestState: await conformanceRequestState.mint({
          scenario: "multi-round",
          round: 2,
        }),
      });
    }
    return { content: [{ type: "text", text: `Color: ${color.color}` }] };
  }
);

server.tool(
  {
    name: "test_input_required_result_tampered_state",
    description: "Rejects tampered requestState values before completing",
  },
  async (_input, ctx) => {
    const state = ctx.requestState<{ scenario: string; round: number }>();
    const confirmation = acceptedContent(
      ctx.inputResponses,
      "confirm",
      confirmationSchema
    );
    if (
      state?.scenario !== "tampered-state" ||
      state.round !== 1 ||
      confirmation === undefined
    ) {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: "Confirm this request",
            requestedSchema: confirmationSchema,
          }),
        },
        requestState: await conformanceRequestState.mint({
          scenario: "tampered-state",
          round: 1,
        }),
      });
    }
    return { content: [{ type: "text", text: "confirmed" }] };
  }
);

server.tool(
  {
    name: "test_input_required_result_capabilities",
    description: "Only requests interactive methods declared by the client",
  },
  async (_input, ctx) => {
    if (ctx.client.can("sampling")) {
      return inputRequired({
        inputRequests: {
          sample: inputRequired.createMessage({
            messages: [
              { role: "user", content: { type: "text", text: "Say hello" } },
            ],
            maxTokens: 20,
          }),
        },
      });
    }
    if (ctx.client.can("elicitation")) {
      return inputRequired({
        inputRequests: {
          name: inputRequired.elicit({
            message: "What is your name?",
            requestedSchema: nameSchema,
          }),
        },
      });
    }
    return { content: [{ type: "text", text: "No interactive capability" }] };
  }
);

server.prompt(
  {
    name: "test_input_required_result_prompt",
    description:
      "Prompt fixture that requests elicited context before completion",
  },
  async (_args, ctx) => {
    const context = acceptedContent(
      ctx.inputResponses,
      "user_context",
      z.object({ context: z.string() })
    );
    if (context === undefined) {
      return inputRequired({
        inputRequests: {
          user_context: inputRequired.elicit({
            message: "What context should the prompt use?",
            requestedSchema: z.object({ context: z.string() }),
          }),
        },
      });
    }
    return {
      messages: [
        { role: "user", content: { type: "text", text: context.context } },
      ],
    };
  }
);

server.tool(
  {
    name: "test_missing_capability",
    description: "Exercises missing client-capability validation for sampling",
  },
  async (_input, ctx) => {
    // Returning a sampling request delegates the -32021 capability error to
    // the protocol runtime when this request did not advertise sampling.
    if (!ctx.client.can("sampling")) {
      return inputRequired({
        inputRequests: {
          sample: inputRequired.createMessage({
            messages: [
              {
                role: "user",
                content: { type: "text", text: "Capability check" },
              },
            ],
            maxTokens: 20,
          }),
        },
      });
    }
    return { content: [{ type: "text", text: "sampling available" }] };
  }
);

server.tool(
  {
    name: "test_streaming_elicitation",
    description:
      "Produces an elicitation input_required result for stream checks",
  },
  async (_input, ctx) => {
    if (
      acceptedContent(ctx.inputResponses, "stream", nameSchema) === undefined
    ) {
      return inputRequired({
        inputRequests: {
          stream: inputRequired.elicit({
            message: "Provide a streaming name",
            requestedSchema: nameSchema,
          }),
        },
      });
    }
    return { content: [{ type: "text", text: "stream completed" }] };
  }
);

server.tool(
  {
    name: "test_logging_tool",
    description:
      "Diagnostic tool that completes without unsolicited log frames",
  },
  async (_input, ctx) => {
    // Deliberately avoid emitting a protocol log here. The stateless scenario
    // invokes this diagnostic without the per-request log-level descriptor.
    void ctx;
    return { content: [{ type: "text", text: "logging complete" }] };
  }
);

server.tool(
  {
    name: "test_trigger_tool_change",
    description: "Publishes a tools/list_changed subscription notification",
  },
  async () => {
    await server.notifyToolsChanged();
    return { content: [{ type: "text", text: "tool list changed" }] };
  }
);

server.tool(
  {
    name: "test_trigger_prompt_change",
    description: "Publishes a prompts/list_changed subscription notification",
  },
  async () => {
    await server.notifyPromptsChanged();
    return { content: [{ type: "text", text: "prompt list changed" }] };
  }
);

// =============================================================================
// RESOURCES
// =============================================================================

server.resource(
  {
    name: "static_text",
    uri: "test://static-text",
    title: "Static Text Resource",
    description: "A static text resource",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: "This is static text content",
      },
    ],
  })
);

server.resource(
  {
    name: "static_binary",
    uri: "test://static-binary",
    title: "Static Binary Resource",
    description: "A static binary resource",
    mimeType: "application/octet-stream",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/octet-stream",
        blob: STATIC_BINARY_BLOB,
      },
    ],
  })
);

server.resourceTemplate(
  {
    name: "template_resource",
    uriTemplate: "test://template/{id}/data",
    title: "Template Resource",
    description: "A templated resource",
    mimeType: "application/json",
  },
  async (uri, params) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          id: params.id,
          templateTest: true,
          data: `Data for ID: ${String(params.id)}`,
        }),
      },
    ],
  })
);

let subscribableResourceValue = "Initial value";

server.resource(
  {
    name: "subscribable_resource",
    uri: "test://subscribable",
    title: "Subscribable Resource",
    description: "A resource that supports subscriptions and can be updated",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: subscribableResourceValue,
      },
    ],
  })
);

server.tool(
  {
    name: "update_subscribable_resource",
    description: "Update the subscribable resource and notify subscribers",
    inputSchema: z.object({
      newValue: z.string().default("Updated value"),
    }),
  },
  async ({ newValue }) => {
    subscribableResourceValue = newValue;
    await server.notifyResourceUpdated("test://subscribable");
    return {
      content: [{ type: "text", text: `Resource updated to: ${newValue}` }],
    };
  }
);

// =============================================================================
// PROMPTS
// =============================================================================

server.prompt(
  {
    name: "test_simple_prompt",
    description: "A simple prompt without arguments",
  },
  async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "This is a simple prompt without any arguments.",
        },
      },
    ],
  })
);

server.prompt(
  {
    name: "test_prompt_with_arguments",
    description: "A prompt that accepts arguments",
    schema: z.object({
      arg1: completable(z.string(), () => ["default1"]).optional(),
      arg2: completable(z.string(), () => ["default2"]).optional(),
    }),
  },
  async ({ arg1 = "default1", arg2 = "default2" }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Prompt with arguments: arg1='${arg1}', arg2='${arg2}'`,
        },
      },
    ],
  })
);

server.prompt(
  {
    name: "test_prompt_with_embedded_resource",
    description: "A prompt that includes an embedded resource",
    schema: z.object({
      resourceUri: z.string().optional(),
    }),
  },
  async ({ resourceUri = "config://embedded" }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: "Here is the configuration:" },
      },
      {
        role: "user",
        content: {
          type: "resource",
          resource: {
            uri: resourceUri,
            mimeType: "application/json",
            text: JSON.stringify({ setting: "value" }),
          },
        },
      },
    ],
  })
);

server.prompt(
  {
    name: "test_prompt_with_image",
    description: "A prompt that includes an image",
  },
  async () => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: "Here is a test image:" },
      },
      {
        role: "user",
        content: {
          type: "image",
          data: RED_PIXEL_PNG,
          mimeType: "image/png",
        },
      },
    ],
  })
);

// =============================================================================
// LEGACY APPS SDK FALLBACK
// =============================================================================

const appsSdkOnlyCardUri = "ui://widget/apps-sdk-only-card.html";

server.resource(
  {
    name: "apps-sdk-only-card",
    uri: appsSdkOnlyCardUri,
    description: "ChatGPT-only Apps SDK card",
    mimeType: "text/html+skybridge",
    _meta: {
      "openai/widgetDescription":
        "A card that only works in ChatGPT through the legacy Apps SDK",
      "openai/widgetPrefersBorder": true,
    },
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/html+skybridge",
        text: `<!doctype html>
<html>
  <body>
    <article id="card">ChatGPT-only Apps SDK card</article>
    <script>
      const message = window.openai?.toolOutput?.message;
      if (typeof message === "string") document.querySelector("#card").textContent = message;
    </script>
  </body>
</html>`,
      },
    ],
  })
);

server.tool(
  {
    name: "apps-sdk-only-card",
    description:
      "Return a legacy Apps SDK card without advertising MCP Apps UI metadata",
    inputSchema: z.object({
      message: z.string().optional().describe("Optional message to display"),
    }),
    _meta: {
      "openai/outputTemplate": appsSdkOnlyCardUri,
    },
  },
  async ({ message = "This card uses the legacy Apps SDK only." }) => ({
    content: [{ type: "text", text: message }],
    structuredContent: { message },
  })
);

// =============================================================================
// VIEW: get-weather-delayed
// =============================================================================

const weatherData: Record<
  string,
  {
    temperature: number;
    conditions: string;
    humidity: number;
    windSpeed: number;
  }
> = {
  tokyo: {
    temperature: 22,
    conditions: "Partly Cloudy",
    humidity: 65,
    windSpeed: 12,
  },
  london: { temperature: 15, conditions: "Rainy", humidity: 80, windSpeed: 20 },
  "new york": {
    temperature: 18,
    conditions: "Sunny",
    humidity: 55,
    windSpeed: 8,
  },
  paris: { temperature: 17, conditions: "Cloudy", humidity: 70, windSpeed: 15 },
};

export const getWeatherDelayed = server.tool(
  {
    name: "get-weather-delayed",
    description:
      "Get weather with artificial 5-second delay to test view lifecycle (Issue #930)",
    inputSchema: z.object({
      city: z.string().describe("City name"),
      delay: z
        .number()
        .default(5000)
        .describe("Delay in milliseconds (default: 5000)"),
    }),
    outputSchema: weatherOutputSchema,
    view: {
      name: "weather-display",
      description:
        "Interactive weather card showing temperature and conditions",
    },
  },
  async ({ city, delay }) => {
    await sleep(delay);

    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] ?? {
      temperature: 20,
      conditions: "Unknown",
      humidity: 50,
      windSpeed: 10,
    };
    const structuredContent = { city, ...weather };

    return {
      content: [
        {
          type: "text",
          text: `Current weather in ${city}: ${weather.conditions}, ${weather.temperature}°C (fetched after ${delay}ms delay)`,
        },
      ],
      structuredContent,
    };
  }
);

// =============================================================================
// VIEW: chat-conformance
// =============================================================================

export const chatConformanceHelper = server.tool(
  {
    name: "chat-conformance-helper",
    description: "App-only helper used by the local Chat conformance fixture",
    inputSchema: z.object({ value: z.string() }),
    visibility: "app",
  },
  async ({ value }) => ({
    content: [{ type: "text", text: `App helper received: ${value}` }],
    structuredContent: { value },
  })
);

export const chatConformanceFixture = server.tool(
  {
    name: "chat-conformance-fixture",
    description:
      "Open the local fixture for Chat messages, model context, and app-only tools",
    inputSchema: z.object({}),
    outputSchema: z.object({ ready: z.boolean() }),
    view: {
      name: "chat-conformance",
      description: "Local fixture for MCP Apps Chat conformance",
    },
  },
  async () => ({
    content: [{ type: "text", text: "Chat conformance fixture ready" }],
    structuredContent: { ready: true },
  })
);

server.tool(
  {
    name: "report-client-capabilities",
    description:
      "Report client capabilities advertised on this connection (MCP Apps / UI extension).",
    inputSchema: z.object({}),
    outputSchema: z.object({ supportsApps: z.boolean() }),
  },
  async (_input, ctx) => {
    const supportsApps = ctx.client.supportsViews();
    return {
      content: [{ type: "text", text: JSON.stringify({ supportsApps }) }],
      structuredContent: { supportsApps },
    };
  }
);

export default server;
