/**
 * Compile-time contract tests for an augmented {@link Register} module.
 *
 * Module augmentation is file-scoped — kept separate from empty-Register tests.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  DeepPartial,
  RegisteredTools,
} from "../src/react/types/register.js";
import type {
  CallToolResult,
  CallToolSuccess,
  InvalidToolResultError,
  ToolContextError,
  ToolError,
} from "../src/react/types/result-types.js";
import type { CallToolHandle } from "../src/react/hooks/use-call-tool.js";
import type { ToolContextHandle } from "../src/react/hooks/use-tool-context.js";

declare module "../src/react/types/register.js" {
  interface Register {
    tools: typeof import("./fixtures/react-register-tools.js");
  }
}

describe("ToolsFromModule / Register", () => {
  it("filters non-ToolRef exports from the registered tools map", () => {
    type Tools = RegisteredTools;
    expectTypeOf<keyof Tools>().toEqualTypeOf<
      "search-fruits" | "get-details" | "ping"
    >();
    expectTypeOf<Tools["search-fruits"]["input"]>().toEqualTypeOf<{
      query?: string | undefined;
    }>();
    expectTypeOf<Tools["search-fruits"]["output"]>().toEqualTypeOf<{
      query: string;
      items: { id: string }[];
    }>();
    // No outputSchema → output inferred as `never`.
    expectTypeOf<Tools["ping"]["output"]>().toEqualTypeOf<never>();
    expect(true).toBe(true);
  });

  it("narrows useToolContext toolInput / toolOutput by status without toolName", () => {
    type Handle = ToolContextHandle<"search-fruits">;
    type Input = RegisteredTools["search-fruits"]["input"];
    type Output = RegisteredTools["search-fruits"]["output"];

    type Ready = Extract<Handle, { status: "ready" }>;
    expectTypeOf<Ready["toolOutput"]>().toEqualTypeOf<Output>();
    expectTypeOf<Ready["toolInput"]>().toEqualTypeOf<Input | undefined>();
    expectTypeOf<"toolName" extends keyof Ready ? true : false>().toEqualTypeOf<false>();

    type Streaming = Extract<Handle, { status: "streaming" }>;
    expectTypeOf<Streaming["toolInput"]>().toEqualTypeOf<
      DeepPartial<Input> | undefined
    >();
    expectTypeOf<Streaming["toolOutput"]>().toEqualTypeOf<undefined>();
    expectTypeOf<"toolName" extends keyof Streaming ? true : false>().toEqualTypeOf<false>();

    type Cancelled = Extract<Handle, { status: "cancelled" }>;
    expectTypeOf<Cancelled["reason"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Cancelled["toolInput"]>().toEqualTypeOf<
      DeepPartial<Input> | undefined
    >();
    expectTypeOf<Cancelled["toolOutput"]>().toEqualTypeOf<undefined>();
    expectTypeOf<"toolName" extends keyof Cancelled ? true : false>().toEqualTypeOf<false>();

    type Pending = Extract<Handle, { status: "pending" }>;
    expectTypeOf<Pending["toolInput"]>().toEqualTypeOf<Input | undefined>();
    expectTypeOf<Pending["toolOutput"]>().toEqualTypeOf<undefined>();
    expectTypeOf<"toolName" extends keyof Pending ? true : false>().toEqualTypeOf<false>();

    type ErrorBranch = Extract<Handle, { status: "error" }>;
    expectTypeOf<ErrorBranch["toolOutput"]>().toEqualTypeOf<undefined>();
    expectTypeOf<"toolName" extends keyof ErrorBranch ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<ErrorBranch["error"]>().toEqualTypeOf<ToolContextError>();
    expectTypeOf<ErrorBranch["error"]>().toEqualTypeOf<
      ToolError | InvalidToolResultError
    >();
    expectTypeOf<ErrorBranch["error"]["message"]>().toEqualTypeOf<string>();

    expect(true).toBe(true);
  });

  it("keeps ready toolOutput as a union when Name is a union (no toolName discriminant)", () => {
    type Handle = ToolContextHandle<"search-fruits" | "get-details">;
    type SearchOut = RegisteredTools["search-fruits"]["output"];
    type DetailsOut = RegisteredTools["get-details"]["output"];

    type Ready = Extract<Handle, { status: "ready" }>;
    expectTypeOf<Ready["toolOutput"]>().toEqualTypeOf<SearchOut | DetailsOut>();
    expectTypeOf<"toolName" extends keyof Ready ? true : false>().toEqualTypeOf<false>();

    type Streaming = Extract<Handle, { status: "streaming" }>;
    expectTypeOf<"toolName" extends keyof Streaming ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<Streaming["toolInput"]>().toEqualTypeOf<
      | DeepPartial<RegisteredTools["search-fruits"]["input"]>
      | DeepPartial<RegisteredTools["get-details"]["input"]>
      | undefined
    >();

    expect(true).toBe(true);
  });

  it("keeps untyped useToolContext ready without toolName", () => {
    type Handle = ToolContextHandle;
    type Ready = Extract<Handle, { status: "ready" }>;
    expectTypeOf<"toolName" extends keyof Ready ? true : false>().toEqualTypeOf<false>();
    // ToolOutput<never> is `never`; ToolInput<never> | undefined collapses to undefined.
    expectTypeOf<Ready["toolOutput"]>().toEqualTypeOf<never>();
    expectTypeOf<Ready["toolInput"]>().toEqualTypeOf<undefined>();

    type Pending = Extract<Handle, { status: "pending" }>;
    expectTypeOf<"toolName" extends keyof Pending ? true : false>().toEqualTypeOf<false>();

    expect(true).toBe(true);
  });
});

describe("useCallTool augmented Register", () => {
  it("types name union and args/result from Register via CallToolSuccess", () => {
    type Output = RegisteredTools["search-fruits"]["output"];
    type Handle = CallToolHandle<
      RegisteredTools["search-fruits"]["input"],
      Output
    >;

    expectTypeOf<Handle["callTool"]>().parameters.toEqualTypeOf<
      [RegisteredTools["search-fruits"]["input"]]
    >();
    expectTypeOf<Handle["data"]>().toEqualTypeOf<
      CallToolSuccess<Output> | undefined
    >();
    expectTypeOf<Awaited<ReturnType<Handle["callTool"]>>>().toEqualTypeOf<
      CallToolSuccess<Output>
    >();
    expect(true).toBe(true);
  });

  it("exposes success-only data with typed structuredContent", () => {
    type Output = RegisteredTools["search-fruits"]["output"];
    type Success = CallToolSuccess<Output>;

    expectTypeOf<Success["structuredContent"]>().toEqualTypeOf<Output>();
    expectTypeOf<Success["isError"]>().toEqualTypeOf<false | undefined>();

    // CallToolSuccess is assignable to CallToolResult with structuredContent.
    expectTypeOf<Success>().toMatchTypeOf<
      CallToolResult & { structuredContent: Output }
    >();

    expect(true).toBe(true);
  });

  it("adds no structuredContent guarantee for schema-less registered tools", () => {
    type PingHandle = CallToolHandle<
      RegisteredTools["ping"]["input"],
      RegisteredTools["ping"]["output"]
    >;
    type PingSuccess = Awaited<ReturnType<PingHandle["callTool"]>>;

    // `never` output collapses the conditional: exactly the base result shape.
    expectTypeOf<PingSuccess>().toEqualTypeOf<
      CallToolResult & { isError?: false }
    >();
    expectTypeOf<PingHandle["data"]>().toEqualTypeOf<
      (CallToolResult & { isError?: false }) | undefined
    >();
    // structuredContent stays the base optional `unknown` — not typed output.
    expectTypeOf<PingSuccess["structuredContent"]>().toEqualTypeOf<unknown>();

    expect(true).toBe(true);
  });
});
