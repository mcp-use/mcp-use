import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  flattenCallResult,
  matchExpectation,
  oauthProviderContractProblem,
} from "../src/graders/outcome.js";
import type { TaskConfig } from "../src/types.js";

describe("matchExpectation", () => {
  it("contains: substring match", () => {
    expect(
      matchExpectation("The result is 5.", { type: "contains", value: "5" })
    ).toBe(true);
    expect(matchExpectation("nope", { type: "contains", value: "5" })).toBe(
      false
    );
  });

  it("not-contains: passes only when the substring is absent", () => {
    expect(
      matchExpectation("Workout", { type: "not-contains", value: "Groceries" })
    ).toBe(true);
    expect(
      matchExpectation("Groceries, Workout", {
        type: "not-contains",
        value: "Groceries",
      })
    ).toBe(false);
  });

  it("number-equals: matches a bare number", () => {
    expect(matchExpectation("5", { type: "number-equals", value: 5 })).toBe(
      true
    );
  });

  it("number-equals: tolerates prose around the number", () => {
    expect(
      matchExpectation("The sum of 2 and 3 is 5", {
        type: "number-equals",
        value: 5,
      })
    ).toBe(true);
  });

  it("number-equals: handles negatives and decimals", () => {
    expect(
      matchExpectation("-2.5", { type: "number-equals", value: -2.5 })
    ).toBe(true);
    expect(
      matchExpectation("Result: -2.5", { type: "number-equals", value: -2.5 })
    ).toBe(true);
  });

  it("number-equals: does not pass on a different number", () => {
    expect(matchExpectation("6", { type: "number-equals", value: 5 })).toBe(
      false
    );
  });

  it("number-equals: fails when no number present", () => {
    expect(matchExpectation("five", { type: "number-equals", value: 5 })).toBe(
      false
    );
  });
});

describe("flattenCallResult", () => {
  it("joins text content blocks", () => {
    expect(
      flattenCallResult({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      })
    ).toBe("a b");
  });

  it("includes structuredContent", () => {
    expect(
      flattenCallResult({ content: [], structuredContent: { sum: 5 } })
    ).toContain('"sum":5');
  });

  it("ignores non-text blocks", () => {
    expect(flattenCallResult({ content: [{ type: "image", data: "…" }] })).toBe(
      ""
    );
  });
});

describe("oauthProviderContractProblem", () => {
  const clerkTask = {
    id: "03-oauth-clerk",
    title: "Clerk",
    entryCandidates: ["src/server.ts"],
    requiresZodSchema: true,
    expectedTools: [],
    calls: [],
    oauth: { backend: "clerk" },
  } satisfies TaskConfig;

  it("passes when the Clerk task uses oauthClerkProvider", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oauth-provider-ok-"));
    await mkdir(join(workspace, "src"));
    await writeFile(
      join(workspace, "src", "server.ts"),
      "import { oauthClerkProvider } from 'mcp-use/server';\nconst oauth = oauthClerkProvider();\n"
    );

    await expect(
      oauthProviderContractProblem(workspace, clerkTask)
    ).resolves.toBeNull();
  });

  it("fails the Clerk task when code uses generic OAuth instead", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "oauth-provider-bad-"));
    await mkdir(join(workspace, "src"));
    await writeFile(
      join(workspace, "src", "server.ts"),
      "import { oauthCustomProvider } from 'mcp-use/server';\nconst oauth = oauthCustomProvider({});\n"
    );

    await expect(
      oauthProviderContractProblem(workspace, clerkTask)
    ).resolves.toContain("oauthClerkProvider()");
  });
});
