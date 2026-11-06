import { CommandError, UsageError } from "../../core/errors.js";
import { writeProjectLink } from "../project/link-file.js";
import type { DeployInput, DeployValues } from "./types.js";

/** Reject source/build flags and malformed external endpoints before auth. */
export function validateExternalOptions(values: DeployValues): void {
  const endpoint = values["external-url"];
  if (endpoint === undefined) return;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new UsageError("--external-url must be an absolute HTTPS URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    endpoint.includes("#") ||
    endpoint.length > 2048
  )
    throw new UsageError(
      "--external-url requires HTTPS without credentials or a fragment (maximum 2048 characters)."
    );
  const flags = [
    "no-github",
    "branch",
    "root-dir",
    "region",
    "env",
    "env-file",
    "build-command",
    "start-command",
    "dockerfile",
    "watch-paths",
    "wait-for-ci",
  ] as const;
  const incompatible = flags.filter(
    (key) => values[key] !== undefined && values[key] !== false
  );
  if (incompatible.length)
    throw new UsageError(
      `--external-url cannot be combined with ${incompatible.map((key) => `--${key}`).join(", ")}.`,
      { code: "invalid_argument_combination" }
    );
}

/** Verify the existing provider speaks MCP before changing Cloud state. */
export async function validateExternalServer(url: string): Promise<void> {
  // The protocol client is bundled; Cloud use does not require the framework client.
  // eslint-disable-next-line import/no-extraneous-dependencies
  const protocol = await import("@modelcontextprotocol/client");
  const { Client, StreamableHTTPClientTransport } = protocol;
  const client = new Client(
    { name: "manufact-cli", version: "1" },
    { versionNegotiation: { mode: "auto" } }
  );
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)), {
      timeout: 30_000,
    });
  } catch {
    throw new CommandError(
      "invalid_mcp_server",
      "The external URL did not complete an MCP handshake. Check the endpoint path."
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/** Register an existing provider, or update the same linked external server. */
export async function deployExternal(input: DeployInput): Promise<{
  sourceType: "external";
  serverId: string;
  status: "registered";
  externalUrl: string;
}> {
  const { cloud, cwd, existing, values } = input;
  const externalUrl = values["external-url"]!;
  if (existing !== null && !input.linkedServer?.isExternal)
    throw new UsageError(
      "The link points to a hosted server. Pass --new to register a separate external server.",
      { code: "source_mode_conflict" }
    );
  const server =
    existing === null
      ? (
          await cloud.call(
            cloud.client.POST("/api/v1/servers", {
              body: {
                type: "external",
                organizationId: cloud.organization.id,
                url: externalUrl,
                ...(values.name !== undefined ? { name: values.name } : {}),
              },
            })
          )
        ).server
      : await cloud.call(
          cloud.client.PATCH("/api/v1/servers/{id}", {
            params: { path: { id: existing.serverId } },
            body: {
              externalUrl,
              ...(values.name !== undefined ? { name: values.name } : {}),
            },
          })
        );
  await writeProjectLink(cwd, {
    orgId: cloud.organization.id,
    serverId: server.id,
  });
  return {
    sourceType: "external",
    serverId: server.id,
    status: "registered",
    externalUrl,
  };
}
