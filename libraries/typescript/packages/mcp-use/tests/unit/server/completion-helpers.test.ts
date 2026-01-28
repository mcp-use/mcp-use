import { describe, it, expect } from "vitest";
import {
  completable,
  type CompletionContext,
} from "../../../src/server/utils/completion-helpers.js";
import { z } from "zod";
import {
  isCompletable,
  getCompleter,
} from "@modelcontextprotocol/sdk/server/completable.js";

describe("completable()", () => {
  const mustGetCompleter = <T extends z.ZodTypeAny>(schema: T) => {
    const completer = getCompleter(schema);
    expect(completer).toBeDefined();
    return completer!;
  };

  describe("Overload 1: List-based completion (primitives)", () => {
    const schema = completable(z.string(), ["python", "typescript", "go"]);

    it("should filter by prefix match (case-insensitive)", async () => {
      const completer = mustGetCompleter(schema);

      const result = await completer("TY");
      expect(result).toEqual(["typescript"]);
    });
    it("should return all values when input is empty", async () => {
      const completer = mustGetCompleter(schema);

      const result = await completer("");
      expect(result).toEqual(["python", "typescript", "go"]);
    });
    it("should return a completable schema", () => {
      expect(isCompletable(schema)).toBe(true);
    });
    it("should handle number values and return numbers", async () => {
      const numberSchema = completable(z.number(), [11, 22, 33]);
      const completer = mustGetCompleter(numberSchema);

      const result = await completer(2);
      expect(result).toEqual([22]);
      expect(typeof result[0]).toBe("number");
    });
    it("should handle enum values and return matching values", async () => {
      const enumSchema = completable(z.enum(["python", "typescript", "go"]), [
        "python",
        "typescript",
        "go",
      ]);
      const completer = mustGetCompleter(enumSchema);

      const result = await completer("python");
      expect(result).toEqual(["python"]);
    });
  });

  describe("Overload 2: Callback-based completion (any schema)", () => {
    const stringCallback = (value: string) => {
      return ["python", "typescript", "go"].filter((v) => v.startsWith(value));
    };
    const stringSchema = completable(z.string(), stringCallback);

    it("should use the provided callback", async () => {
      const completer = mustGetCompleter(stringSchema);

      const result = await completer("t");
      expect(result).toEqual(["typescript"]);
    });
    it("should return a completable schema", () => {
      expect(isCompletable(stringSchema)).toBe(true);
    });
    it("should support dynamic/contextual completion", async () => {
      const dynamicCallback = (value: string, ctx?: CompletionContext) => {
        const projectType = ctx?.arguments?.projectType;

        const langs =
          projectType === "frontend"
            ? ["typescript", "javascript"]
            : ["python", "go"];

        return langs.filter((l) => l.startsWith(value));
      };

      const dynamicSchema = completable(z.string(), dynamicCallback);
      const completer = mustGetCompleter(dynamicSchema);
      const value = ""; // empty string to test all values

      const frontendResult = await completer(value, {
        arguments: { projectType: "frontend" },
      });
      const backendResult = await completer(value, {
        arguments: { projectType: "backend" },
      });

      expect(frontendResult).toEqual(["typescript", "javascript"]);
      expect(backendResult).toEqual(["python", "go"]);
    });
    it("should handle number completion with callback", async () => {
      const numberCallback = async (value: number): Promise<number[]> => {
        // Simulate fetching available versions based on input
        const allVersions = [1, 2, 3, 10, 20, 30, 100, 200, 300];
        return allVersions.filter((v) =>
          v.toString().startsWith(value.toString())
        );
      };

      const numberSchema = completable(z.number(), numberCallback);
      const completer = mustGetCompleter(numberSchema);

      const result = await completer(2);
      expect(result).toEqual([2, 20, 200]);
      expect(result.every((v) => typeof v === "number")).toBe(true);
    });
    it("should handle null and undefined values in list-based completion", async () => {
      const schema = completable(z.string(), ["python", "typescript", "go"]);
      const completer = mustGetCompleter(schema);

      // Should handle null/undefined by treating as empty string
      const nullResult = await completer(null as any);
      const undefinedResult = await completer(undefined as any);

      expect(nullResult).toEqual(["python", "typescript", "go"]);
      expect(undefinedResult).toEqual(["python", "typescript", "go"]);
    });
    it("should handle null and undefined values in callback-based completion", async () => {
      const callback = async (
        value: string | null | undefined
      ): Promise<string[]> => {
        const prefix = (value ?? "").toLowerCase();
        return ["python", "typescript", "go"].filter((v) =>
          v.toLowerCase().startsWith(prefix)
        );
      };

      const schema = completable(z.string(), callback);
      const completer = mustGetCompleter(schema);

      const nullResult = await completer(null as any);
      const undefinedResult = await completer(undefined as any);

      expect(nullResult).toEqual(["python", "typescript", "go"]);
      expect(undefinedResult).toEqual(["python", "typescript", "go"]);
    });
    it("should handle callback errors gracefully", async () => {
      const errorCallback = async (): Promise<string[]> => {
        throw new Error("Completion failed");
      };

      const schema = completable(z.string(), errorCallback);
      const completer = mustGetCompleter(schema);

      await expect(completer("test")).rejects.toThrow("Completion failed");
    });
    it("should handle empty context in callback", async () => {
      const callback = async (
        value: string,
        ctx?: CompletionContext
      ): Promise<string[]> => {
        // Should work even when context is undefined
        expect(ctx).toBeUndefined();
        return ["python", "typescript", "go"].filter((v) =>
          v.startsWith(value)
        );
      };

      const schema = completable(z.string(), callback);
      const completer = mustGetCompleter(schema);

      const result = await completer("t");
      expect(result).toEqual(["typescript"]);
    });
  });
});
