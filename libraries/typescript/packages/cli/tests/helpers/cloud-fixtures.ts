/**
 * Spec-valid Cloud objects for fake replies.
 *
 * The fake Cloud rejects replies that don't match the OpenAPI spec, and most
 * Cloud objects have many required fields a test doesn't care about. These
 * builders fill those with neutral values; a test passes the fields its
 * assertions depend on, so every value it asserts is visible in the test.
 */
import type {
  GetApiV1DeploymentsByIdResponses,
  GetApiV1DeploymentsResponses,
} from "../../src/cloud/api/generated/types.gen.js";

/** A deployment as `GET /api/v1/deployments/{id}` returns it. */
type Deployment = GetApiV1DeploymentsByIdResponses[200];

/** A deployment as `GET /api/v1/deployments` lists it. */
type DeploymentListItem = GetApiV1DeploymentsResponses[200]["items"][number];

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
