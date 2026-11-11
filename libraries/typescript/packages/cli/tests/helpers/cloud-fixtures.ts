/**
 * Spec-valid Cloud objects for fake replies.
 *
 * The fake Cloud rejects replies that don't match the OpenAPI spec, and most
 * Cloud objects have many required fields a test doesn't care about. These
 * builders fill those with neutral values; a test passes the fields its
 * assertions depend on, so every value it asserts is visible in the test.
 */
import type { operations } from "../../src/cloud/api/generated/types.gen.js";

/** A deployment as `GET /api/v1/deployments/{id}` returns it. */
type Deployment =
  operations["getApiV1DeploymentsById"]["responses"][200]["content"]["application/json"];

/** A deployment as `GET /api/v1/deployments` lists it. */
type DeploymentListItem =
  operations["getApiV1Deployments"]["responses"][200]["content"]["application/json"]["items"][number];

const TIMESTAMP = "2026-01-01T00:00:00Z";

/** A deployment with neutral values for every field not in `fields`. */
export function deployment(
  fields: Pick<Deployment, "id"> & Partial<Deployment>
): Deployment & DeploymentListItem {
  return {
    name: "deployment",
    source: { type: "github" },
    status: "running",
    port: null,
    healthCheckPath: null,
    pipelineMeta: null,
    error: null,
    buildLogs: null,
    gitCommitSha: null,
    gitBranch: null,
    gitCommitMessage: null,
    isProductionDeployment: null,
    previousDeploymentId: null,
    deploymentVersion: null,
    deploymentTrigger: null,
    pipelinePhase: null,
    userId: "user_1",
    serverId: "server_1",
    organizationId: "org_1",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    // The spec documents these as non-null strings, though Cloud can return
    // null for deployments that never built.
    buildStartedAt: TIMESTAMP,
    buildCompletedAt: TIMESTAMP,
    archivedAt: TIMESTAMP,
    mcpUrl: "https://example.run.mcp-use.com/mcp",
    ...fields,
  };
}

/** An organization as Cloud lists it. */
type Organization =
  operations["getApiV1Organizations"]["responses"][200]["content"]["application/json"]["organizations"][number];

/** An organization with neutral values for every field not in fields. */
export function organization(
  fields: Pick<Organization, "id" | "slug"> & Partial<Organization>
): Organization {
  return { name: "Organization", role: "owner", ...fields };
}

/** A session for an API key whose user has email. */
export function session(
  email: string
): operations["getSession"]["responses"][200]["content"]["application/json"] {
  return { user: { email } };
}

/** A server as the project lookup returns it. */
type Server =
  operations["getApiV1ServersById"]["responses"][200]["content"]["application/json"];

/** A server with neutral values for fields outside the assertion. */
export function server(fields: Pick<Server, "id"> & Partial<Server>): Server {
  return {
    name: "Server",
    slug: "server",
    organizationId: "org_1",
    description: null,
    status: "running",
    mcpUrl: "https://example.com/mcp",
    dashboardUrl: "https://manufact.com/cloud/org-one/servers/srv_1",
    publicRoutingMode: "gateway",
    region: "AUTO",
    activeDeploymentId: null,
    isExternal: false,
    ...fields,
  };
}
