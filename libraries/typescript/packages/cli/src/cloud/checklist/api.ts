// Bundled into the CLI artifact.
// eslint-disable-next-line import/no-extraneous-dependencies
import createClient from "openapi-fetch";
import { CommandError } from "../../core/errors.js";
import { cloudApiUrl } from "../cloud-api.js";

/** Public checklist run fields used by the CLI. */
export interface ChecklistRun {
  id: string;
  status: string;
  serverId?: string;
  deploymentId?: string | null;
  gitBranch?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  isReadyForChatgpt?: boolean | null;
  isReadyForClaudeai?: boolean | null;
  checks?: Array<{
    checkId: string;
    checkName: string;
    status: string;
    message?: string | null;
  }>;
}

type ResponseBody<T> = {
  responses: { 200: { content: { "application/json": T } } };
};
/** These user-facing routes are not included in the published API document. */
interface ChecklistPaths {
  "/api/v1/server-audits/{serverId}/audits": {
    get: ResponseBody<{
      items: unknown[];
      total: number;
      limit: number;
      skip: number;
    }> & {
      parameters: {
        path: { serverId: string };
        query?: { limit?: number; skip?: number; branch?: string };
      };
    };
    post: {
      parameters: { path: { serverId: string } };
      requestBody: { content: { "application/json": { branch?: string } } };
      responses: { 201: { content: { "application/json": unknown } } };
    };
  };
  "/api/v1/server-audits/{serverId}/audits/{auditId}": {
    get: ResponseBody<unknown> & {
      parameters: { path: { serverId: string; auditId: string } };
    };
  };
  "/api/v1/server-audits/{serverId}/audits/{auditId}/cancel": {
    post: ResponseBody<unknown> & {
      parameters: { path: { serverId: string; auditId: string } };
    };
  };
}

/** Use the normal API credential and organization for checklist requests. */
export function checklistClient(apiKey: string, organizationId: string) {
  return createClient<ChecklistPaths>({
    baseUrl: cloudApiUrl().replace(/\/api\/v1$/, ""),
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
      "x-profile-id": organizationId,
    },
  });
}

/** Keep the documented CLI result stable and limit it to public run fields. */
export function checklistRun(value: unknown): ChecklistRun {
  if (
    value === null ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("status" in value) ||
    typeof value.status !== "string"
  )
    throw new CommandError(
      "cloud_api_error",
      "Manufact Cloud returned an invalid checklist run."
    );
  const item = value as Record<string, unknown>;
  const result: ChecklistRun = { id: value.id, status: value.status };
  for (const key of [
    "serverId",
    "deploymentId",
    "gitBranch",
    "errorMessage",
    "createdAt",
    "startedAt",
    "completedAt",
    "isReadyForChatgpt",
    "isReadyForClaudeai",
  ] as const) {
    if (item[key] !== undefined) Object.assign(result, { [key]: item[key] });
  }
  if (Array.isArray(item.checks)) {
    result.checks = item.checks
      .filter(
        (check): check is Record<string, unknown> =>
          check !== null && typeof check === "object"
      )
      .map((check) => ({
        checkId: String(check.checkId ?? ""),
        checkName: String(check.checkName ?? ""),
        status: String(check.status ?? "unknown"),
        ...(typeof check.message === "string" || check.message === null
          ? { message: check.message }
          : {}),
      }));
  }
  return result;
}
