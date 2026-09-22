import { serve } from "@hono/node-server";
import { MCPServer } from "mcp-use";
import { z } from "zod";
import { createFirebaseAuth, type FirebaseOAuthUser } from "./auth/index.js";
import { openConfiguration } from "./config.js";
import { createRequestHandler } from "./http.js";

const whoamiOutputSchema = z.object({
  user: z.object({
    source: z.string(),
    subject: z.string(),
    profile: z.object({
      email: z.string().optional(),
      emailVerified: z.boolean().optional(),
      name: z.string().optional(),
      image: z.string().optional(),
    }),
  }),
  scopes: z.array(z.string()),
  clientId: z.string().nullable(),
  resource: z.string().nullable(),
  expiresAt: z
    .number()
    .describe("Access-token expiry as Unix time in seconds."),
});

async function main() {
  const config = await openConfiguration();
  let server: MCPServer<FirebaseOAuthUser> | undefined;
  let listener: ReturnType<typeof serve> | undefined;
  let stopping: Promise<void> | undefined;
  const shutdown = () =>
    (stopping ??= (async () => {
      const httpClosed = new Promise<void>((resolve) => {
        if (!listener) return resolve();
        listener.close(() => resolve());
        if ("closeIdleConnections" in listener) listener.closeIdleConnections();
      });
      const results = await Promise.allSettled([httpClosed, server?.close()]);
      await config.close();
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("MCP shutdown failed");
      }
    })());

  try {
    const application = await createFirebaseAuth(config.auth);
    const schema = await application.getMigrations();
    if (
      schema.toBeCreated.length ||
      schema.toBeAdded.length ||
      schema.toBeAddedIndexes.length ||
      schema.unsafeChanges.length
    ) {
      console.error(
        "Authentication schema is out of date. Run pnpm migrate before starting."
      );
      throw new Error("Authentication schema needs migration");
    }
    const integration = await application.connect();
    server = new MCPServer({
      name: "firebase-mcp",
      version: "1.0.0",
      requestAuth: integration.requestAuth,
      publicLandingPage: true,
    });
    server.tool(
      {
        name: "whoami",
        description:
          "Return the verified Firebase identity, granted scopes, OAuth client, resource and access-token expiry.",
        outputSchema: whoamiOutputSchema,
        annotations: { readOnlyHint: true },
      },
      async (_args, ctx) => {
        const data = {
          user: ctx.auth.user,
          scopes: ctx.auth.scopes,
          clientId: ctx.auth.clientId ?? null,
          resource: ctx.auth.resource?.href ?? null,
          expiresAt: ctx.auth.expiresAt,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        };
      }
    );

    const fetch = createRequestHandler({
      origin: config.origin,
      auth: integration.handleRequest,
      mcp: server.fetch,
    });
    const localPort = await new Promise<number>((resolve, reject) => {
      listener = serve(
        {
          fetch,
          hostname: process.env.HOST ?? "127.0.0.1",
          port: Number(
            process.env.PORT ?? (new URL(config.origin).port || 3000)
          ),
        },
        (address) => {
          listener?.off("error", reject);
          resolve(address.port);
        }
      );
      listener.once("error", reject);
    });
    console.log(
      `Firebase MCP listening at ${config.auth.resource} (local port ${localPort})`
    );
    const onSignal = () => {
      void shutdown().catch(() => {
        console.error("Firebase MCP could not shut down cleanly.");
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  } catch (error) {
    await shutdown();
    throw error;
  }
}

await main().catch((error: unknown) => {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "EADDRINUSE"
  ) {
    const port =
      "port" in error && typeof error.port === "number" ? ` ${error.port}` : "";
    console.error(
      `Firebase MCP could not start: port${port} is already in use. Reuse the running server or stop it before starting another instance.`
    );
  } else {
    console.error(
      "Firebase MCP could not start. Check configuration, database access, and any schema diagnostics above."
    );
  }
  process.exitCode = 1;
});
