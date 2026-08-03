import { describe, expect, it } from "vitest";
import { tokenizeJson } from "../../src/client/utils/highlightJson";

describe("tokenizeJson", () => {
  it("classifies keys, strings, numbers, booleans, null", () => {
    const tokens = tokenizeJson(
      '{\n  "name": "mcp",\n  "count": 2,\n  "ok": true,\n  "empty": null\n}'
    );

    const byText = Object.fromEntries(tokens.map((t) => [t.text, t.kind]));

    expect(byText['"name"']).toBe("key");
    expect(byText['"mcp"']).toBe("string");
    expect(byText['"count"']).toBe("key");
    expect(byText["2"]).toBe("number");
    expect(byText['"ok"']).toBe("key");
    expect(byText.true).toBe("boolean");
    expect(byText['"empty"']).toBe("key");
    expect(byText.null).toBe("null");
  });
});
