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
    // A stateless handler starts from the top on both the initial call and
    // every retry. Inspect this round's response before deciding to ask again.
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
    // Missing or invalid accepted content means this invocation still needs
    // input, so return input_required instead of continuing.
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

    // Side effects belong after accepted, validated input because every
    // input_required round invokes this callback again from the beginning.
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

    // This is either the initial call (missing) or a fresh retry. Resolve the
    // retry response first; only the missing case should request input.
    const response = inputResponse(ctx.inputResponses, "service-authorization");
    if (response.kind === "elicit" && response.action !== "accept") {
      return {
        content: [
          {
            type: "text",
            text:
              response.action === "decline"
                ? "Authorization declined by the user."
                : "Authorization cancelled by the user.",
          },
        ],
        isError: true,
      };
    }

    if (response.kind === "elicit" && response.action === "accept") {
      return {
        content: [
          {
            type: "text",
            text: `Authorization page opened for ${service}. Verify the backend callback before treating the service as connected.`,
          },
        ],
      };
    }

    return inputRequired({
      inputRequests: {
        "service-authorization": inputRequired.elicitUrl({
          message: `Authorize access to ${service}`,
          url: authorizationUrl.href,
        }),
      },
    });
  }
);

export default server;
