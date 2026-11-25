import { describe, expectTypeOf, it } from "vitest";

import type { RequestClientContext } from "../src/context.js";
import type { MiddlewareContext } from "../src/middleware/mcp-middleware.js";

describe("MiddlewareContext client", () => {
  it("exposes the runtime client on tools/list middleware", () => {
    expectTypeOf<
      MiddlewareContext<"tools/list">["client"]
    >().toEqualTypeOf<RequestClientContext>();
  });

  it("exposes the runtime client on tools/call middleware", () => {
    expectTypeOf<
      MiddlewareContext<"tools/call">["client"]
    >().toEqualTypeOf<RequestClientContext>();
  });
});
