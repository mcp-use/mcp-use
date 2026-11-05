export interface paths {
    "/api/v1/deployments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description List deployments visible to the current user. Optional filters: serverId, organizationId, status, branch, take (max 200). */
        get: operations["getApiV1Deployments"];
        put?: never;
        /** @description Trigger a new deployment for an existing GitHub server */
        post: operations["postApiV1Deployments"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/deployments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Get a single deployment by ID */
        get: operations["getApiV1DeploymentsById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/deployments/{id}/build-logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Get build logs for a deployment. Supports offset-based tailing: pass `offset` (character index) to receive only new content appended after that position. Returns `logs` (the text slice), `offset` (character position to send on the next request), `status` (current deployment status), and `totalLength`. */
        get: operations["getApiV1DeploymentsByIdBuildLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/deployments/{id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Get runtime logs for a deployment. Optional query `lines` (1–5000) limits how many trailing log lines are returned after provider fetch. */
        get: operations["getApiV1DeploymentsByIdLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getApiV1Deployments: {
        parameters: {
            query?: {
                serverId?: string;
                organizationId?: string;
                status?: string;
                /** @description Exact Git branch name. Omit to list all branches. */
                branch?: string;
                limit?: number;
                take?: number;
                skip?: number;
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            source: unknown;
                            status: string;
                            port: number | null;
                            healthCheckPath: string | null;
                            pipelineMeta: ((string | number | boolean | null) | {
                                [key: string]: unknown;
                            } | unknown[]) | null;
                            error: string | null;
                            buildLogs: string | null;
                            gitCommitSha: string | null;
                            gitBranch: string | null;
                            gitCommitMessage: string | null;
                            isProductionDeployment: boolean | null;
                            previousDeploymentId: string | null;
                            deploymentVersion: number | null;
                            deploymentTrigger: string | null;
                            pipelinePhase: string | null;
                            userId: string;
                            serverId: string;
                            organizationId: string;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            updatedAt: string;
                            /** Format: date-time */
                            buildStartedAt: string;
                            /** Format: date-time */
                            buildCompletedAt: string;
                            /** Format: date-time */
                            archivedAt: string;
                            failureMeta?: {
                                error: string;
                                code: string;
                                /** @enum {string} */
                                feature: "usageCredits" | "external_mcp" | "public_chat" | "submission_pack" | "submission_checklist" | "evals" | "publishing_checks" | "projects" | "teamMembers" | "region" | "previewDeploys" | "coldStart" | "requestsPerMonth" | "logRetention" | "githubOrg" | "customDomain";
                                /** @enum {string} */
                                currentTier: "free" | "pay_as_you_go" | "pro" | "hobby" | "startup" | "enterprise" | "custom";
                                /** @enum {string} */
                                requiredTier: "free" | "pay_as_you_go" | "pro" | "hobby" | "startup" | "enterprise" | "custom";
                                current?: number;
                                limit?: number | "unlimited";
                            } | null;
                            mcpUrl: string;
                            latestChecklistAuditStatus?: ("pending" | "running" | "completed" | "failed") | null;
                            latestChecklistAudit?: {
                                id: string;
                                /** Format: date-time */
                                createdAt: string;
                                checks: {
                                    /** @enum {string} */
                                    status: "pass" | "fail" | "skip" | "pending";
                                    severity: string;
                                    category: string;
                                }[];
                            } | null;
                        }[];
                        total: number;
                        limit: number;
                        skip: number;
                    };
                };
            };
            /** @description Validation error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @constant */
                        code: "VALIDATION_ERROR";
                        details: unknown;
                    };
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
        };
    };
    postApiV1Deployments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    serverId: string;
                    name?: string;
                    branch?: string;
                    commitSha?: string;
                    commitMessage?: string;
                    /** @enum {string} */
                    trigger?: "manual" | "webhook" | "redeploy" | "rollback";
                    prNumber?: number;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Plan limit exceeded */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        /** @enum {string} */
                        feature: "usageCredits" | "external_mcp" | "public_chat" | "submission_pack" | "submission_checklist" | "evals" | "publishing_checks" | "projects" | "teamMembers" | "region" | "previewDeploys" | "coldStart" | "requestsPerMonth" | "logRetention" | "githubOrg" | "customDomain";
                        /** @enum {string} */
                        currentTier: "free" | "pay_as_you_go" | "pro" | "hobby" | "startup" | "enterprise" | "custom";
                        /** @enum {string} */
                        requiredTier: "free" | "pay_as_you_go" | "pro" | "hobby" | "startup" | "enterprise" | "custom";
                        current?: number;
                        limit?: number | "unlimited";
                    };
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
        };
    };
    getApiV1DeploymentsById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        source: unknown;
                        status: string;
                        port: number | null;
                        healthCheckPath: string | null;
                        pipelineMeta: ((string | number | boolean | null) | {
                            [key: string]: unknown;
                        } | unknown[]) | null;
                        error: string | null;
                        buildLogs: string | null;
                        gitCommitSha: string | null;
                        gitBranch: string | null;
                        gitCommitMessage: string | null;
                        isProductionDeployment: boolean | null;
                        previousDeploymentId: string | null;
                        deploymentVersion: number | null;
                        deploymentTrigger: string | null;
                        pipelinePhase: string | null;
                        userId: string;
                        serverId: string;
                        organizationId: string;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        updatedAt: string;
                        /** Format: date-time */
                        buildStartedAt: string;
                        /** Format: date-time */
                        buildCompletedAt: string;
                        /** Format: date-time */
                        archivedAt: string;
                        failureMeta?: {
                            error: string;
                            code: string;
                            /** @enum {string} */
                            feature: "usageCredits" | "external_mcp" | "public_chat" | "submission_pack" | "submission_checklist" | "evals" | "publishing_checks" | "projects" | "teamMembers" | "region" | "previewDeploys" | "coldStart" | "requestsPerMonth" | "logRetention" | "githubOrg" | "customDomain";
                            /** @enum {string} */
                            currentTier: "free" | "pay_as_you_go" | "pro" | "hobby" | "startup" | "enterprise" | "custom";
                            /** @enum {string} */
                            requiredTier: "free" | "pay_as_you_go" | "pro" | "hobby" | "startup" | "enterprise" | "custom";
                            current?: number;
                            limit?: number | "unlimited";
                        } | null;
                        mcpUrl: string;
                        latestChecklistAuditStatus?: ("pending" | "running" | "completed" | "failed") | null;
                        latestChecklistAudit?: {
                            id: string;
                            /** Format: date-time */
                            createdAt: string;
                            checks: {
                                /** @enum {string} */
                                status: "pass" | "fail" | "skip" | "pending";
                                severity: string;
                                category: string;
                            }[];
                        } | null;
                    };
                };
            };
            /** @description Validation error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @constant */
                        code: "VALIDATION_ERROR";
                        details: unknown;
                    };
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
        };
    };
    getApiV1DeploymentsByIdBuildLogs: {
        parameters: {
            query?: {
                offset?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        logs: string;
                        offset: number;
                        totalLength: number;
                        status: string;
                    };
                };
            };
            /** @description Validation error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @constant */
                        code: "VALIDATION_ERROR";
                        details: unknown;
                    };
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
        };
    };
    getApiV1DeploymentsByIdLogs: {
        parameters: {
            query?: {
                lines?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        logs: string;
                    };
                };
            };
            /** @description Validation error */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @constant */
                        code: "VALIDATION_ERROR";
                        details: unknown;
                    };
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        /** @description Stable application error code, when available. */
                        code?: string;
                        details?: unknown;
                    };
                };
            };
        };
    };
}
