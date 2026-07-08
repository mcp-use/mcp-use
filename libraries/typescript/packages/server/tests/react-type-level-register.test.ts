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
import type { CallToolResult } from "../src/react/types/result-types.js";
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
    expectTypeOf<keyof Tools>().toEqualTypeOf<"search-fruits" | "get-details">();
    expectTypeOf<Tools["search-fruits"]["input"]>().toEqualTypeOf<{
      query?: string | undefined;
    }>();
    expectTypeOf<Tools["search-fruits"]["output"]>().toEqualTypeOf<{
      query: string;
      items: { id: string }[];
    }>();
    expect(true).toBe(true);
  });

  it("narrows useToolContext toolInput / toolOutput by status", () => {
    type Handle = ToolContextHandle<"search-fruits">;
    type Input = RegisteredTools["search-fruits"]["input"];
    type Output = RegisteredTools["search-fruits"]["output"];

    type Ready = Extract<Handle, { status: "ready" }>;
    expectTypeOf<Ready["toolOutput"]>().toEqualTypeOf<Output>();
    expectTypeOf<Ready["toolInput"]>().toEqualTypeOf<Input | undefined>();

    type Streaming = Extract<Handle, { status: "streaming" }>;
    expectTypeOf<Streaming["toolInput"]>().toEqualTypeOf<
      DeepPartial<Input> | undefined
    >();
    expectTypeOf<Streaming["toolOutput"]>().toEqualTypeOf<undefined>();

    type Cancelled = Extract<Handle, { status: "cancelled" }>;
    expectTypeOf<Cancelled["reason"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Cancelled["toolInput"]>().toEqualTypeOf<
      DeepPartial<Input> | undefined
    >();
    expectTypeOf<Cancelled["toolOutput"]>().toEqualTypeOf<undefined>();

    type Pending = Extract<Handle, { status: "pending" }>;
    expectTypeOf<Pending["toolInput"]>().toEqualTypeOf<Input | undefined>();
    expectTypeOf<Pending["toolOutput"]>().toEqualTypeOf<undefined>();

    expect(true).toBe(true);
  });
});

describe("useCallTool augmented Register", () => {
  it("types name union and args/result from Register", () => {
    type Handle = CallToolHandle<
      RegisteredTools["search-fruits"]["input"],
      RegisteredTools["search-fruits"]["output"]
    >;
    type ExpectedData =
      | (CallToolResult & {
          structuredContent: RegisteredTools["search-fruits"]["output"];
        })
      | undefined;

    expectTypeOf<Handle["callTool"]>().parameters.toEqualTypeOf<
      [RegisteredTools["search-fruits"]["input"]]
    >();
    expectTypeOf<Handle["data"]>().toEqualTypeOf<ExpectedData>();
    expect(true).toBe(true);
  });
});
