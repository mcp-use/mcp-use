import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "elicitation-example",
  version: "1.0.0",
  title: "Elicitation Example",
  description:
    "Demonstrates typed form and URL elicitation through input_required.",
});

const deploymentApproval = z.object({
  approve: z.boolean().describe("Approve this deployment"),
  note: z
    .string()
    .max(200)
    .optional()
    .describe("Optional note for the deployment log"),
});

server.tool(
  {
    name: "deploy",
    title: "Deploy an environment",
    description:
      "Ask the user for confirmation, then simulate deploying an environment.",
    inputSchema: z.object({
      environment: z
        .enum(["staging", "production"])
        .describe("Environment to deploy"),
    }),
    outputSchema: z.object({
      environment: z.string(),
      deployed: z.boolean(),
      note: z.string().optional(),
    }),
    annotations: { destructiveHint: true },
  },
  async ({ environment }, ctx) => {
    const confirmation = await ctx.elicit(
      "deployment-approval",
      `Deploy to ${environment}?`,
      deploymentApproval
    );

    // On the first invocation this is an InputRequiredResult. The client
    // collects input and retries this same tool call with the response.
    if (confirmation.status === "required") {
      return confirmation.result;
    }

    if (confirmation.status !== "accept") {
      return {
        content: [
          {
            type: "text",
            text:
              confirmation.status === "decline"
                ? "Deployment declined by the user."
                : "Deployment cancelled by the user.",
          },
        ],
        isError: true,
      };
    }

    if (!confirmation.data.approve) {
      return {
        content: [{ type: "text", text: "Deployment was not approved." }],
        isError: true,
      };
    }

    // Put side effects after elicitation is accepted: the callback runs again
    // for every input_required round.
    const result = {
      environment,
      deployed: true,
      ...(confirmation.data.note !== undefined && {
        note: confirmation.data.note,
      }),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  }
);

server.tool(
  {
    name: "connect-service",
    title: "Connect a service",
    description:
      "Open a browser authorization flow using URL-mode elicitation.",
    inputSchema: z.object({
      service: z.enum(["github", "slack"]),
    }),
  },
  async ({ service }, ctx) => {
    const authorizationUrl = new URL("https://example.com/authorize");
    authorizationUrl.searchParams.set("service", service);

    const authorization = await ctx.elicit(
      "service-authorization",
      `Authorize access to ${service}`,
      authorizationUrl.href
    );

    if (authorization.status === "required") {
      return authorization.result;
    }

    if (authorization.status !== "accept") {
      return {
        content: [
          {
            type: "text",
            text:
              authorization.status === "decline"
                ? "Authorization declined by the user."
                : "Authorization cancelled by the user.",
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Authorization page opened for ${service}. Verify the backend callback before treating the service as connected.`,
        },
      ],
    };
  }
);

export default server;
