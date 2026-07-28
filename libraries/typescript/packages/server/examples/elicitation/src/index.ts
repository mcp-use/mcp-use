import {
  acceptedContent,
  inputRequired,
  inputResponse,
  MCPServer,
} from "mcp-use";
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
    const response = inputResponse(ctx.inputResponses, "deployment-approval");
    if (response.kind === "elicit" && response.action !== "accept") {
      return {
        content: [
          {
            type: "text",
            text:
              response.action === "decline"
                ? "Deployment declined by the user."
                : "Deployment cancelled by the user.",
          },
        ],
        isError: true,
      };
    }

    const confirmation = acceptedContent(
      ctx.inputResponses,
      "deployment-approval",
      deploymentApproval
    );

    if (confirmation === undefined) {
      return inputRequired({
        inputRequests: {
          "deployment-approval": inputRequired.elicit({
            message: `Deploy to ${environment}?`,
            requestedSchema: deploymentApproval,
          }),
        },
      });
    }

    if (!confirmation.approve) {
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
      ...(confirmation.note !== undefined && {
        note: confirmation.note,
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

    const response = inputResponse(ctx.inputResponses, "service-authorization");
    if (response.kind === "missing") {
      return inputRequired({
        inputRequests: {
          "service-authorization": inputRequired.elicitUrl({
            message: `Authorize access to ${service}`,
            url: authorizationUrl.href,
          }),
        },
      });
    }

    if (response.kind !== "elicit" || response.action !== "accept") {
      return {
        content: [
          {
            type: "text",
            text:
              response.kind === "elicit" && response.action === "decline"
                ? "Authorization declined by the user."
                : "Authorization cancelled by the user.",
          },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Connected ${service}.` }],
    };
  }
);

export default server;
