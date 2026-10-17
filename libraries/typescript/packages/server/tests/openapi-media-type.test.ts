import { describe, expect, it } from "vitest";
import type { MCPServer } from "../src/server.js";
import { registerOpenAPITools } from "../src/openapi/index.js";
import type {
  FromOpenAPIOptions,
  OpenAPIRequestBodyObject,
} from "../src/openapi/types.js";

async function requestWith(
  content: NonNullable<OpenAPIRequestBodyObject["content"]>,
  expectedMediaType: string,
  headers?: Record<string, string>,
  includeBody = true
) {
  let handler:
    | ((params: Record<string, unknown>) => Promise<unknown>)
    | undefined;
  let request: RequestInit | undefined;
  const options: FromOpenAPIOptions = {
    baseUrl: "https://api.example.test",
    ...(headers === undefined ? {} : { headers }),
    spec: {
      openapi: "3.1.0",
      info: { title: "JSON API", version: "1" },
      paths: {
        "/articles": {
          post: {
            operationId: "createArticle",
            requestBody: { content },
            responses: { "200": { description: "ok" } },
          },
        },
      },
    },
    fetch: async (_input, init) => {
      request = init;
      if (
        includeBody &&
        new Headers(init?.headers).get("content-type") !== expectedMediaType
      ) {
        return new Response("Unsupported media type", { status: 415 });
      }
      return Response.json({ ok: true });
    },
  };
  const server = {
    tool: (_definition: unknown, callback: typeof handler) => {
      handler = callback;
    },
  } as unknown as Pick<MCPServer, "tool">;
  registerOpenAPITools(server, options);
  expect(handler).toBeDefined();
  const result = await handler!(includeBody ? { body: { title: "Test" } } : {});
  return {
    result,
    headers: new Headers(request?.headers),
    body: request?.body,
  };
}

const schema = {
  type: "object" as const,
  properties: { title: { type: "string" as const } },
};

describe("OpenAPI request media types", () => {
  it.each(["application/vnd.api+json", "application/merge-patch+json"])(
    "uses the declared %s media type",
    async (mediaType) => {
      const response = await requestWith(
        { [mediaType]: { schema } },
        mediaType
      );
      expect(response.headers.get("content-type")).toBe(mediaType);
      expect(response.body).toBe(JSON.stringify({ title: "Test" }));
      expect(response.result).not.toMatchObject({ isError: true });
    }
  );

  it("prefers application/json over a vendor JSON type", async () => {
    const response = await requestWith(
      {
        "application/vnd.api+json": { schema },
        "application/json": { schema },
      },
      "application/json"
    );
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.result).not.toMatchObject({ isError: true });
  });

  it("keeps the application/json fallback for wildcard JSON", async () => {
    const response = await requestWith(
      { "application/*+json": { schema } },
      "application/json"
    );
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("preserves an explicit case-insensitive content-type override", async () => {
    const response = await requestWith(
      { "application/vnd.api+json": { schema } },
      "application/custom+json",
      { "Content-Type": "application/custom+json" }
    );
    expect(response.headers.get("content-type")).toBe(
      "application/custom+json"
    );
    expect(response.result).not.toMatchObject({ isError: true });
  });

  it("does not add a content-type when an optional body is omitted", async () => {
    const response = await requestWith(
      { "application/vnd.api+json": { schema } },
      "application/vnd.api+json",
      undefined,
      false
    );
    expect(response.headers.has("content-type")).toBe(false);
    expect(response.body).toBeUndefined();
  });
});

it.each([
  { "application/*+json": {}, "application/vnd.api+json": { schema } },
  { "application/*+json": { schema }, "application/vnd.api+json": { schema } },
  { "application/json": {}, "application/vnd.api+json": { schema } },
])(
  "skips schema-less entries and prefers concrete vendor media types: %j",
  async (content) => {
    const response = await requestWith(content, "application/vnd.api+json");
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.api+json"
    );
    expect(response.body).toBe(JSON.stringify({ title: "Test" }));
    expect(response.result).not.toMatchObject({ isError: true });
  }
);

it.each(["Application/Vnd.API+JSON", "Application/JSON"])(
  "recognizes case-insensitive media types: %s",
  async (mediaType) => {
    const response = await requestWith({ [mediaType]: { schema } }, mediaType);
    expect(response.headers.get("content-type")).toBe(mediaType);
    expect(response.body).toBe(JSON.stringify({ title: "Test" }));
  }
);

it("does not treat a +json substring as a structured JSON suffix", async () => {
  const response = await requestWith(
    { "application/not+json-extra": { schema } },
    "application/json"
  );
  expect(response.headers.has("content-type")).toBe(false);
  expect(response.body).toBeUndefined();
});
