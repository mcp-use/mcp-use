/**
 * Compile-time contract tests for an augmented {@link Register} module.
 *
 * Module augmentation is file-scoped — kept separate from empty-Register tests.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  DeepPartial,
  LoadingProps,
  RegisteredTools,
  ViewProps,
} from "../src/react/types/register.js";
import type { CallToolResult } from "../src/react/types/result-types.js";
import type { CallToolHandle } from "../src/react/hooks/use-call-tool.js";

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

  it("resolves ViewProps from output and LoadingProps from deep-partial input", () => {
    type Props = ViewProps<"search-fruits">;
    type Loading = LoadingProps<"search-fruits">;

    expectTypeOf<Props>().toEqualTypeOf<{
      query: string;
      items: { id: string }[];
    }>();
    expectTypeOf<Loading["partialInput"]>().toEqualTypeOf<
      DeepPartial<{ query?: string | undefined }> | undefined
    >();
    expectTypeOf<Loading["isStreaming"]>().toEqualTypeOf<boolean>();
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
