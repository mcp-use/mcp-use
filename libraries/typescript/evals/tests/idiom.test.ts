import { describe, expect, it } from "vitest";
import { gradeIdiomFiles } from "../src/graders/idiom.js";
import type { TaskConfig } from "../src/types.js";

const TASK: TaskConfig = {
  id: "test",
  title: "test",
  entryCandidates: [],
  requiresZodSchema: true,
  expectedTools: [],
  calls: [],
};

const IDIOMATIC = `
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({ name: "s", version: "1.0.0" });
server.tool(
  { name: "add", description: "Add", schema: z.object({ a: z.number(), b: z.number() }) },
  async ({ a, b }) => text(String(a + b)),
);
await server.listen();
`;

describe("idiom detectors", () => {
  it("produces no findings for idiomatic code", () => {
    const grade = gradeIdiomFiles(
      new Map([["src/server.ts", IDIOMATIC]]),
      TASK
    );
    expect(grade.findings).toEqual([]);
  });

  it("flags raw @modelcontextprotocol/sdk imports", () => {
    const code = `import { Server } from "@modelcontextprotocol/sdk/server/index.js";`;
    const grade = gradeIdiomFiles(new Map([["src/server.ts", code]]), TASK);
    const finding = grade.findings.find((f) => f.detector === "raw-sdk-import");
    expect(finding).toBeDefined();
    expect(finding!.file).toBe("src/server.ts");
    expect(finding!.line).toBe(1);
  });

  it("flags createMCPServer instead of the MCPServer constructor", () => {
    const code = `
import { createMCPServer, text } from "mcp-use/server";
import { z } from "zod";
const server = createMCPServer({ name: "s", version: "1" });
server.tool({ name: "t", schema: z.object({}) }, async () => text("hi"));
`;
    const grade = gradeIdiomFiles(new Map([["src/server.ts", code]]), TASK);
    const finding = grade.findings.find(
      (f) => f.detector === "create-mcp-server-factory"
    );
    expect(finding).toBeDefined();
    expect(finding!.file).toBe("src/server.ts");
    expect(finding!.evidence).toContain("createMCPServer");
  });

  it("flags hand-rolled content blocks", () => {
    const code = `
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";
const server = new MCPServer({ name: "s", version: "1" });
server.tool({ name: "t", schema: z.object({}) }, async () => {
  return { content: [{ type: "text", text: "hi" }] };
});
`;
    const grade = gradeIdiomFiles(new Map([["index.ts", code]]), TASK);
    expect(
      grade.findings.some((f) => f.detector === "hand-rolled-content-block")
    ).toBe(true);
  });

  it("flags hand-rolled content blocks spanning multiple lines", () => {
    const code = `
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";
const x = {
  content: [
    {
      type: "text",
      text: "hi",
    },
  ],
};
const hasSchema = { schema: z.object({}) };
`;
    const grade = gradeIdiomFiles(new Map([["index.ts", code]]), TASK);
    expect(
      grade.findings.some((f) => f.detector === "hand-rolled-content-block")
    ).toBe(true);
  });

  it("flags direct window.openai usage in widget code", () => {
    const code = `
import { McpUseProvider, useCallTool } from "mcp-use/react";
export default function Widget() {
  window.openai?.callTool("like_listing", { listingId: "frontend-platform" });
  return null;
}
`;
    const grade = gradeIdiomFiles(
      new Map([["resources/job-board/widget.tsx", code]]),
      TASK
    );
    const finding = grade.findings.find(
      (f) => f.detector === "direct-window-openai"
    );
    expect(finding).toBeDefined();
    expect(finding!.file).toBe("resources/job-board/widget.tsx");
    expect(finding!.evidence).toContain("window.openai");
  });

  it("flags tool registration without any response-helper import", () => {
    const code = `
import { MCPServer } from "mcp-use/server";
import { z } from "zod";
const server = new MCPServer({ name: "s", version: "1" });
server.tool({ name: "t", schema: z.object({}) }, async () => ({ ok: true }));
`;
    const grade = gradeIdiomFiles(new Map([["index.ts", code]]), TASK);
    expect(
      grade.findings.some((f) => f.detector === "no-response-helper-import")
    ).toBe(true);
  });

  it("flags missing zod schema when the task requires one", () => {
    const code = `
import { MCPServer, text } from "mcp-use/server";
const server = new MCPServer({ name: "s", version: "1" });
server.tool({ name: "add", description: "Add" }, async () => text("5"));
`;
    const grade = gradeIdiomFiles(new Map([["index.ts", code]]), TASK);
    const finding = grade.findings.find(
      (f) => f.detector === "missing-zod-schema"
    );
    expect(finding).toBeDefined();
    expect(finding!.evidence).toContain("zod is never imported");
  });

  it("does not apply the zod detector when the task doesn't require schemas", () => {
    const code = `
import { MCPServer, text } from "mcp-use/server";
const server = new MCPServer({ name: "s", version: "1" });
server.tool({ name: "ping" }, async () => text("pong"));
`;
    const grade = gradeIdiomFiles(new Map([["index.ts", code]]), {
      ...TASK,
      requiresZodSchema: false,
    });
    expect(
      grade.findings.some((f) => f.detector === "missing-zod-schema")
    ).toBe(false);
  });

  it("flags hand-rolled auth on oauth tasks when the SDK oauth support is unused", () => {
    const code = `
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";
const server = new MCPServer({ name: "s", version: "1" });
server.use(async (c, next) => {
  if (!(await verifyJwtSomehow(c.req.header("Authorization"))))
    return c.json({ error: "unauthorized" }, 401);
  await next();
});
server.tool({ name: "whoami", schema: z.object({}) }, async () => text("me"));
`;
    const oauthTask: TaskConfig = { ...TASK, oauth: { backend: "clerk" } };
    const grade = gradeIdiomFiles(
      new Map([["src/server.ts", code]]),
      oauthTask
    );
    expect(
      grade.findings.some((f) => f.detector === "hand-rolled-auth")
    ).toBe(true);
  });

  it("does not flag auth when the expected oauth provider is configured", () => {
    const code = `
import { MCPServer, oauthClerkProvider, text } from "mcp-use/server";
import { z } from "zod";
const server = new MCPServer({
  name: "s",
  version: "1",
  oauth: oauthClerkProvider(),
});
server.tool({ name: "whoami", schema: z.object({}) }, async () => text("me"));
`;
    const oauthTask: TaskConfig = { ...TASK, oauth: { backend: "clerk" } };
    const grade = gradeIdiomFiles(
      new Map([["src/server.ts", code]]),
      oauthTask
    );
    expect(
      grade.findings.some(
        (f) =>
          f.detector === "hand-rolled-auth" ||
          f.detector === "wrong-oauth-provider"
      )
    ).toBe(false);
  });

  it("flags the wrong provider factory without double-reporting hand-rolled auth", () => {
    const code = `
import { MCPServer, oauthCustomProvider, text } from "mcp-use/server";
import { z } from "zod";
const server = new MCPServer({
  name: "s",
  version: "1",
  oauth: oauthCustomProvider({
    issuer: "http://localhost",
    authEndpoint: "http://localhost/authorize",
    tokenEndpoint: "http://localhost/token",
    verifyToken: async () => ({ payload: { sub: "u" } }),
  }),
});
server.tool({ name: "whoami", schema: z.object({}) }, async () => text("me"));
`;
    const clerkTask: TaskConfig = { ...TASK, oauth: { backend: "clerk" } };
    const grade = gradeIdiomFiles(
      new Map([["src/server.ts", code]]),
      clerkTask
    );
    expect(
      grade.findings.some((f) => f.detector === "wrong-oauth-provider")
    ).toBe(true);
    expect(
      grade.findings.some((f) => f.detector === "hand-rolled-auth")
    ).toBe(false);
  });

  it("flags direct jose JWKS wiring on the custom-IdP task", () => {
    const code = `
import { MCPServer, oauthCustomProvider, text } from "mcp-use/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
const jwks = createRemoteJWKSet(new URL(process.env.OAUTH_JWKS_URL!));
const server = new MCPServer({
  name: "s",
  version: "1",
  oauth: oauthCustomProvider({
    issuer: process.env.OAUTH_ISSUER!,
    authEndpoint: process.env.OAUTH_AUTH_ENDPOINT!,
    tokenEndpoint: process.env.OAUTH_TOKEN_ENDPOINT!,
    verifyToken: async (token) => jwtVerify(token, jwks),
  }),
});
server.tool({ name: "whoami", schema: z.object({}) }, async () => text("me"));
`;
    const oktaTask: TaskConfig = { ...TASK, oauth: { backend: "okta" } };
    const grade = gradeIdiomFiles(new Map([["src/server.ts", code]]), oktaTask);
    expect(
      grade.findings.some((f) => f.detector === "hand-rolled-jwks-verify")
    ).toBe(true);
  });

  it("does not flag JWKS wiring that goes through the SDK's jwksVerifier", () => {
    const code = `
import { MCPServer, jwksVerifier, oauthCustomProvider, text } from "mcp-use/server";
import { z } from "zod";
const server = new MCPServer({
  name: "s",
  version: "1",
  oauth: oauthCustomProvider({
    issuer: process.env.OAUTH_ISSUER!,
    authEndpoint: process.env.OAUTH_AUTH_ENDPOINT!,
    tokenEndpoint: process.env.OAUTH_TOKEN_ENDPOINT!,
    verifyToken: jwksVerifier({
      jwksUrl: process.env.OAUTH_JWKS_URL!,
      issuer: process.env.OAUTH_ISSUER!,
    }),
  }),
});
server.tool({ name: "whoami", schema: z.object({}) }, async () => text("me"));
`;
    const oktaTask: TaskConfig = { ...TASK, oauth: { backend: "okta" } };
    const grade = gradeIdiomFiles(new Map([["src/server.ts", code]]), oktaTask);
    expect(
      grade.findings.some((f) => f.detector === "hand-rolled-jwks-verify")
    ).toBe(false);
  });

  it("does not apply the auth detector to tasks without an auth contract", () => {
    const code = `
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";
const server = new MCPServer({ name: "s", version: "1" });
server.tool({ name: "t", schema: z.object({}) }, async () => text("hi"));
`;
    const grade = gradeIdiomFiles(new Map([["src/server.ts", code]]), TASK);
    expect(
      grade.findings.some((f) => f.detector === "hand-rolled-auth")
    ).toBe(false);
  });

  it("reports every hit of a detector with its own location", () => {
    const code = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
`;
    const grade = gradeIdiomFiles(new Map([["index.ts", code]]), {
      ...TASK,
      requiresZodSchema: false,
    });
    const rawHits = grade.findings.filter(
      (f) => f.detector === "raw-sdk-import"
    );
    expect(rawHits.length).toBe(2);
    expect(new Set(rawHits.map((f) => f.line)).size).toBe(2);
  });
});
