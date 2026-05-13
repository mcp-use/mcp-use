import { describe, it, expect } from "vitest";
import {
  formatTable,
  formatJson,
  formatToolCall,
  formatResourceContent,
  formatSchema,
  formatList,
  formatError,
  formatSuccess,
  formatInfo,
  formatWarning,
  formatHeader,
  formatKeyValue,
  formatPromptMessages,
} from "../src/utils/format.js";
import type { CallToolResult } from "mcp-use";

describe("Format Utilities", () => {
  describe("formatTable", () => {
    // eslint-disable-next-line no-control-regex
    const ANSI = /\x1b\[[0-9;]*m/g;
    const strip = (s: string) => s.replace(ANSI, "");

    it("renders borderless layout with UPPERCASE bold headers", () => {
      const data = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ];
      const columns = [
        { key: "name", header: "Name" },
        { key: "age", header: "Age" },
      ];

      const result = formatTable(data, columns, { tsv: false });
      const lines = result.split("\n");

      // No box-drawing glyphs anywhere.
      for (const glyph of ["┌", "┐", "└", "┘", "│", "─", "├", "┤", "┬", "┴"]) {
        expect(result).not.toContain(glyph);
      }

      // Header row is UPPERCASE (boldness depends on chalk color support,
      // which is auto-disabled under vitest's non-TTY stdio).
      expect(strip(lines[0])).toContain("NAME");
      expect(strip(lines[0])).toContain("AGE");
      expect(strip(lines[0])).not.toContain("Name");

      // Data rows present and aligned with a two-space gutter.
      expect(strip(lines[1])).toMatch(/^Alice\s{2,}30$/);
      expect(strip(lines[2])).toMatch(/^Bob\s{2,}25$/);

      // Visible-width alignment: name column padded so ages start at the same offset.
      const ageCol1 = strip(lines[1]).indexOf("30");
      const ageCol2 = strip(lines[2]).indexOf("25");
      expect(ageCol1).toBe(ageCol2);
    });

    it("aligns columns when cells contain ANSI escape codes", () => {
      // chalk.bold + chalk.green; pretend they are fixed escapes.
      const data = [
        { name: "\x1b[1mAlice\x1b[22m", status: "\x1b[32mok\x1b[39m" },
        { name: "Bob", status: "fail" },
      ];
      const columns = [
        { key: "name", header: "Name" },
        { key: "status", header: "Status" },
      ];

      const result = formatTable(data, columns, { tsv: false });
      const lines = result.split("\n").map(strip);

      const statusCol1 = lines[1].indexOf("ok");
      const statusCol2 = lines[2].indexOf("fail");
      expect(statusCol1).toBe(statusCol2);
    });

    it("truncates with ellipsis when total width exceeds maxWidth", () => {
      const data = [{ name: "tool-a", description: "x".repeat(200) }];
      const columns = [
        { key: "name", header: "Tool" },
        { key: "description", header: "Description", truncate: true },
      ];

      const result = formatTable(data, columns, { tsv: false, maxWidth: 40 });
      const lines = result.split("\n").map(strip);

      expect(lines[1]).toContain("…");
      expect(lines[1].length).toBeLessThanOrEqual(40);
    });

    it("non-truncatable columns keep their full width", () => {
      const data = [{ name: "very-long-tool-name-here", desc: "z".repeat(80) }];
      const columns = [
        { key: "name", header: "Tool" },
        { key: "desc", header: "Description", truncate: true },
      ];

      const result = formatTable(data, columns, { tsv: false, maxWidth: 40 });
      const lines = result.split("\n").map(strip);

      expect(lines[1]).toContain("very-long-tool-name-here");
    });

    it("emits TSV with no header in tsv mode", () => {
      const data = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ];
      const columns = [
        { key: "name", header: "Name" },
        { key: "age", header: "Age" },
      ];

      const result = formatTable(data, columns, { tsv: true });

      expect(result).toBe("Alice\t30\nBob\t25");
      expect(result).not.toContain("Name");
      expect(result).not.toContain("\x1b[");
    });

    it("strips ANSI escapes from TSV cells", () => {
      const data = [
        { name: "\x1b[1mAlice\x1b[22m", status: "\x1b[32mok\x1b[39m" },
      ];
      const columns = [
        { key: "name", header: "Name" },
        { key: "status", header: "Status" },
      ];

      const result = formatTable(data, columns, { tsv: true });
      expect(result).toBe("Alice\tok");
    });

    it("collapses tabs and newlines inside TSV cells", () => {
      const data = [{ name: "a\tb\nc", value: "x" }];
      const columns = [
        { key: "name", header: "Name" },
        { key: "value", header: "Value" },
      ];

      const result = formatTable(data, columns, { tsv: true });
      // Single tab between columns; embedded tabs/newlines collapsed to spaces.
      expect(result.split("\t")).toHaveLength(2);
      expect(result.startsWith("a b c")).toBe(true);
    });

    it("returns empty string for no data in tsv mode", () => {
      const result = formatTable([], [{ key: "x", header: "X" }], {
        tsv: true,
      });
      expect(result).toBe("");
    });

    it("returns 'No items found' for no data in TTY mode", () => {
      const result = formatTable([], [{ key: "x", header: "X" }], {
        tsv: false,
      });
      expect(result).toContain("No items found");
    });
  });

  describe("formatJson", () => {
    it("should format JSON with pretty printing", () => {
      const data = { name: "Alice", age: 30 };
      const result = formatJson(data, true);

      expect(result).toContain("name");
      expect(result).toContain("Alice");
      expect(result).toContain("\n");
    });

    it("should format JSON without pretty printing", () => {
      const data = { name: "Alice" };
      const result = formatJson(data, false);

      expect(result).toBe('{"name":"Alice"}');
    });
  });

  describe("formatToolCall", () => {
    it("should format successful tool call", () => {
      const result: CallToolResult = {
        content: [{ type: "text", text: "Hello, World!" }],
        isError: false,
      };

      const formatted = formatToolCall(result);

      expect(formatted).toContain("Tool executed successfully");
      expect(formatted).toContain("Hello, World!");
    });

    it("should format failed tool call", () => {
      const result: CallToolResult = {
        content: [{ type: "text", text: "Error message" }],
        isError: true,
      };

      const formatted = formatToolCall(result);

      expect(formatted).toContain("Tool execution failed");
      expect(formatted).toContain("Error details:");
      expect(formatted).toContain("Error message");
    });

    it("should surface fallback text when failed tool has no content", () => {
      const result: CallToolResult = {
        content: [],
        isError: true,
      };

      const formatted = formatToolCall(result);

      expect(formatted).toContain("Tool execution failed");
      expect(formatted).toContain("no error details provided by server");
    });

    it("should prefer structuredContent over text content on failure", () => {
      const result = {
        content: [
          { type: "text", text: '{"code":"E_FAIL","retryable":false}' },
        ],
        isError: true,
        structuredContent: { code: "E_FAIL", retryable: false },
      } as unknown as CallToolResult;

      const formatted = formatToolCall(result);

      expect(formatted).toContain("Tool execution failed");
      expect(formatted).toContain("Structured error data:");
      expect(formatted).toContain("E_FAIL");
      expect(formatted).toContain("retryable");
      // Text content is the spec-required JSON duplicate — should be suppressed
      // so we don't print the same payload twice.
      expect(formatted).not.toContain("Error details:");
    });

    it("should prefer structuredContent over text content on success", () => {
      const result = {
        content: [{ type: "text", text: '{"items":3}' }],
        isError: false,
        structuredContent: { items: 3 },
      } as unknown as CallToolResult;

      const formatted = formatToolCall(result);

      expect(formatted).toContain("items");
      expect(formatted).not.toContain("Structured content:");
      // Only the structured form should appear — the text block is the JSON
      // serialization duplicate per MCP spec.
      const occurrences = formatted.match(/items/g) ?? [];
      expect(occurrences.length).toBe(1);
    });

    it("should handle image content", () => {
      const result: CallToolResult = {
        content: [
          {
            type: "image",
            data: "base64data...",
            mimeType: "image/png",
          },
        ],
        isError: false,
      };

      const formatted = formatToolCall(result);

      expect(formatted).toContain("[Image:");
      expect(formatted).toContain("image/png");
    });

    it("should handle resource content", () => {
      const result: CallToolResult = {
        content: [
          {
            type: "resource",
            resource: {
              uri: "file:///test.txt",
              text: "Resource content",
              mimeType: "text/plain",
            },
          },
        ],
        isError: false,
      };

      const formatted = formatToolCall(result);

      expect(formatted).toContain("[Resource]");
      expect(formatted).toContain("file:///test.txt");
      expect(formatted).toContain("Resource content");
    });

    it("should handle multiple content items", () => {
      const result: CallToolResult = {
        content: [
          { type: "text", text: "First" },
          { type: "text", text: "Second" },
        ],
        isError: false,
      };

      const formatted = formatToolCall(result);

      expect(formatted).toContain("Content 1:");
      expect(formatted).toContain("Content 2:");
      expect(formatted).toContain("First");
      expect(formatted).toContain("Second");
    });
  });

  describe("formatResourceContent", () => {
    it("should format text resource", () => {
      const content = {
        contents: [
          {
            uri: "file:///test.txt",
            text: "File content",
            mimeType: "text/plain",
          },
        ],
      };

      const formatted = formatResourceContent(content);

      expect(formatted).toContain("file:///test.txt");
      expect(formatted).toContain("text/plain");
      expect(formatted).toContain("File content");
    });

    it("should format blob resource", () => {
      const content = {
        contents: [
          {
            uri: "file:///data.bin",
            blob: "binarydata",
            mimeType: "application/octet-stream",
          },
        ],
      };

      const formatted = formatResourceContent(content);

      expect(formatted).toContain("file:///data.bin");
      expect(formatted).toContain("[Binary data:");
    });

    it("should handle empty content", () => {
      const formatted = formatResourceContent({});
      expect(formatted).toContain("No content");
    });

    it("should handle multiple contents", () => {
      const content = {
        contents: [
          { uri: "file:///1.txt", text: "First", mimeType: "text/plain" },
          { uri: "file:///2.txt", text: "Second", mimeType: "text/plain" },
        ],
      };

      const formatted = formatResourceContent(content);

      expect(formatted).toContain("Content 1:");
      expect(formatted).toContain("Content 2:");
      expect(formatted).toContain("First");
      expect(formatted).toContain("Second");
    });
  });

  describe("formatSchema", () => {
    it("should format object schema", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string", description: "User name" },
          age: { type: "number" },
        },
        required: ["name"],
      };

      const formatted = formatSchema(schema);

      expect(formatted).toContain("name");
      expect(formatted).toContain("(string)");
      expect(formatted).toContain("*required");
      expect(formatted).toContain("User name");
      expect(formatted).toContain("age");
      expect(formatted).toContain("(number)");
    });

    it("should format nested object schema", () => {
      const schema = {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
        },
      };

      const formatted = formatSchema(schema);

      expect(formatted).toContain("user");
      expect(formatted).toContain("name");
    });

    it("should format array schema", () => {
      const schema = {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "string" },
          },
        },
      };

      const formatted = formatSchema(schema);

      expect(formatted).toContain("items");
      expect(formatted).toContain("(array)");
      expect(formatted).toContain("Items:");
    });

    it("should handle null schema", () => {
      const formatted = formatSchema(null);
      expect(formatted).toContain("No schema");
    });
  });

  describe("formatList", () => {
    it("should format list with bullets", () => {
      const items = ["Item 1", "Item 2", "Item 3"];
      const formatted = formatList(items);

      expect(formatted).toContain("•");
      expect(formatted).toContain("Item 1");
      expect(formatted).toContain("Item 2");
      expect(formatted).toContain("Item 3");
    });

    it("should use custom bullet", () => {
      const items = ["Item 1"];
      const formatted = formatList(items, "-");

      expect(formatted).toContain("- Item 1");
    });
  });

  describe("Message formatters", () => {
    it("formatError should format error", () => {
      const formatted = formatError("Something went wrong");
      expect(formatted).toContain("Error:");
      expect(formatted).toContain("Something went wrong");
    });

    it("formatError should handle Error objects", () => {
      const error = new Error("Test error");
      const formatted = formatError(error);
      expect(formatted).toContain("Test error");
    });

    it("formatSuccess should format success message", () => {
      const formatted = formatSuccess("Operation completed");
      expect(formatted).toContain("Operation completed");
    });

    it("formatInfo should format info message", () => {
      const formatted = formatInfo("Information");
      expect(formatted).toContain("Information");
    });

    it("formatWarning should format warning message", () => {
      const formatted = formatWarning("Warning message");
      expect(formatted).toContain("Warning message");
    });

    it("formatHeader should format header", () => {
      const formatted = formatHeader("Section Title");
      expect(formatted).toContain("Section Title");
    });
  });

  describe("formatKeyValue", () => {
    it("should format key-value pairs", () => {
      const pairs = {
        Name: "Alice",
        Age: 30,
        Active: true,
      };

      const formatted = formatKeyValue(pairs);

      expect(formatted).toContain("Name");
      expect(formatted).toContain("Alice");
      expect(formatted).toContain("Age");
      expect(formatted).toContain("30");
      expect(formatted).toContain("Active");
      expect(formatted).toContain("true");
    });

    it("should align keys", () => {
      const pairs = {
        Short: "value",
        LongerKey: "value",
      };

      const formatted = formatKeyValue(pairs);
      const lines = formatted.split("\n");

      // Keys should be padded to same length
      expect(lines[0].indexOf(":")).toBe(lines[1].indexOf(":"));
    });
  });

  describe("formatPromptMessages", () => {
    it("should format user message", () => {
      const messages = [
        {
          role: "user",
          content: { type: "text", text: "Hello" },
        },
      ];

      const formatted = formatPromptMessages(messages);

      expect(formatted).toContain("[User]");
      expect(formatted).toContain("Hello");
    });

    it("should format assistant message", () => {
      const messages = [
        {
          role: "assistant",
          content: { type: "text", text: "Hi there" },
        },
      ];

      const formatted = formatPromptMessages(messages);

      expect(formatted).toContain("[Assistant]");
      expect(formatted).toContain("Hi there");
    });

    it("should handle string content", () => {
      const messages = [
        {
          role: "user",
          content: "Hello",
        },
      ];

      const formatted = formatPromptMessages(messages);

      expect(formatted).toContain("Hello");
    });

    it("should handle image content", () => {
      const messages = [
        {
          role: "user",
          content: { type: "image", mimeType: "image/png" },
        },
      ];

      const formatted = formatPromptMessages(messages);

      expect(formatted).toContain("[Image:");
      expect(formatted).toContain("image/png");
    });

    it("should handle resource content", () => {
      const messages = [
        {
          role: "user",
          content: {
            type: "resource",
            resource: {
              uri: "file:///test.txt",
              text: "Content",
            },
          },
        },
      ];

      const formatted = formatPromptMessages(messages);

      expect(formatted).toContain("[Resource:");
      expect(formatted).toContain("file:///test.txt");
      expect(formatted).toContain("Content");
    });

    it("should handle empty messages", () => {
      const formatted = formatPromptMessages([]);
      expect(formatted).toContain("No messages");
    });

    it("should format multiple messages with spacing", () => {
      const messages = [
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
      ];

      const formatted = formatPromptMessages(messages);
      const lines = formatted.split("\n");

      // Should have blank lines between messages
      expect(lines.length).toBeGreaterThan(2);
    });
  });
});
