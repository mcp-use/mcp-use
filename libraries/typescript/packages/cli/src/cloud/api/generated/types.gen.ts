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
<<<<<<< HEAD
}
=======
    /**
     * Unauthorized
     */
    401: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Plan limit exceeded
     */
    403: {
        error: string;
        code: string;
        feature: 'usageCredits' | 'external_mcp' | 'public_chat' | 'submission_pack' | 'submission_checklist' | 'evals' | 'publishing_checks' | 'projects' | 'teamMembers' | 'region' | 'previewDeploys' | 'coldStart' | 'requestsPerMonth' | 'logRetention' | 'githubOrg' | 'customDomain';
        currentTier: 'free' | 'pay_as_you_go' | 'pro' | 'hobby' | 'startup' | 'enterprise' | 'custom';
        requiredTier: 'free' | 'pay_as_you_go' | 'pro' | 'hobby' | 'startup' | 'enterprise' | 'custom';
        current?: number;
        limit?: number | 'unlimited';
    };
    /**
     * Not found
     */
    404: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
};

export type PostApiV1DeploymentsError = PostApiV1DeploymentsErrors[keyof PostApiV1DeploymentsErrors];

export type PostApiV1DeploymentsResponses = {
    /**
     * Created
     */
    201: {
        id: string;
    };
};

export type PostApiV1DeploymentsResponse = PostApiV1DeploymentsResponses[keyof PostApiV1DeploymentsResponses];

export type GetApiV1DeploymentsByIdData = {
    body?: never;
    path: {
        id: string;
    };
    query?: never;
    url: '/api/v1/deployments/{id}';
};

export type GetApiV1DeploymentsByIdErrors = {
    /**
     * Validation error
     */
    400: {
        error: string;
        code: 'VALIDATION_ERROR';
        details: unknown;
    };
    /**
     * Unauthorized
     */
    401: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Forbidden
     */
    403: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Not found
     */
    404: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
};

export type GetApiV1DeploymentsByIdError = GetApiV1DeploymentsByIdErrors[keyof GetApiV1DeploymentsByIdErrors];

export type GetApiV1DeploymentsByIdResponses = {
    /**
     * OK
     */
    200: {
        id: string;
        name: string;
        source: unknown;
        status: string;
        port: number | null;
        healthCheckPath: string | null;
        pipelineMeta: string | number | boolean | null | {
            [key: string]: unknown;
        } | Array<unknown> | null;
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
        createdAt: string;
        updatedAt: string;
        buildStartedAt: string;
        buildCompletedAt: string;
        archivedAt: string;
        failureMeta?: {
            error: string;
            code: string;
            feature: 'usageCredits' | 'external_mcp' | 'public_chat' | 'submission_pack' | 'submission_checklist' | 'evals' | 'publishing_checks' | 'projects' | 'teamMembers' | 'region' | 'previewDeploys' | 'coldStart' | 'requestsPerMonth' | 'logRetention' | 'githubOrg' | 'customDomain';
            currentTier: 'free' | 'pay_as_you_go' | 'pro' | 'hobby' | 'startup' | 'enterprise' | 'custom';
            requiredTier: 'free' | 'pay_as_you_go' | 'pro' | 'hobby' | 'startup' | 'enterprise' | 'custom';
            current?: number;
            limit?: number | 'unlimited';
        } | null;
        mcpUrl: string;
        latestChecklistAuditStatus?: 'pending' | 'running' | 'completed' | 'failed' | null;
        latestChecklistAudit?: {
            id: string;
            createdAt: string;
            checks: Array<{
                status: 'pass' | 'fail' | 'skip' | 'pending';
                severity: string;
                category: string;
            }>;
        } | null;
    };
};

export type GetApiV1DeploymentsByIdResponse = GetApiV1DeploymentsByIdResponses[keyof GetApiV1DeploymentsByIdResponses];

export type GetApiV1DeploymentsByIdBuildLogsData = {
    body?: never;
    path: {
        id: string;
    };
    query?: {
        offset?: number;
    };
    url: '/api/v1/deployments/{id}/build-logs';
};

export type GetApiV1DeploymentsByIdBuildLogsErrors = {
    /**
     * Validation error
     */
    400: {
        error: string;
        code: 'VALIDATION_ERROR';
        details: unknown;
    };
    /**
     * Unauthorized
     */
    401: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Forbidden
     */
    403: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Not found
     */
    404: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
};

export type GetApiV1DeploymentsByIdBuildLogsError = GetApiV1DeploymentsByIdBuildLogsErrors[keyof GetApiV1DeploymentsByIdBuildLogsErrors];

export type GetApiV1DeploymentsByIdBuildLogsResponses = {
    /**
     * OK
     */
    200: {
        logs: string;
        offset: number;
        totalLength: number;
        status: string;
    };
};

export type GetApiV1DeploymentsByIdBuildLogsResponse = GetApiV1DeploymentsByIdBuildLogsResponses[keyof GetApiV1DeploymentsByIdBuildLogsResponses];

export type GetApiV1DeploymentsByIdLogsData = {
    body?: never;
    path: {
        id: string;
    };
    query?: {
        lines?: number;
    };
    url: '/api/v1/deployments/{id}/logs';
};

export type GetApiV1DeploymentsByIdLogsErrors = {
    /**
     * Validation error
     */
    400: {
        error: string;
        code: 'VALIDATION_ERROR';
        details: unknown;
    };
    /**
     * Unauthorized
     */
    401: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Forbidden
     */
    403: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Not found
     */
    404: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
};

export type GetApiV1DeploymentsByIdLogsError = GetApiV1DeploymentsByIdLogsErrors[keyof GetApiV1DeploymentsByIdLogsErrors];

export type GetApiV1DeploymentsByIdLogsResponses = {
    /**
     * OK
     */
    200: {
        logs: string;
    };
};

export type GetApiV1DeploymentsByIdLogsResponse = GetApiV1DeploymentsByIdLogsResponses[keyof GetApiV1DeploymentsByIdLogsResponses];

export type GetApiV1UserPreferencesData = {
    body?: never;
    path?: never;
    query?: never;
    url: '/api/v1/user-preferences';
};

export type GetApiV1UserPreferencesErrors = {
    /**
     * Validation error
     */
    400: {
        error: string;
        code: 'VALIDATION_ERROR';
        details: unknown;
    };
    /**
     * Unauthorized
     */
    401: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Forbidden
     */
    403: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Not found
     */
    404: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
};

export type GetApiV1UserPreferencesError = GetApiV1UserPreferencesErrors[keyof GetApiV1UserPreferencesErrors];

export type GetApiV1UserPreferencesResponses = {
    /**
     * OK
     */
    200: {
        defaultOrganizationId: string | null;
    };
};

export type GetApiV1UserPreferencesResponse = GetApiV1UserPreferencesResponses[keyof GetApiV1UserPreferencesResponses];

export type GetApiV1OrganizationsData = {
    body?: never;
    path?: never;
    query?: never;
    url: '/api/v1/organizations';
};

export type GetApiV1OrganizationsErrors = {
    /**
     * Validation error
     */
    400: {
        error: string;
        code: 'VALIDATION_ERROR';
        details: unknown;
    };
    /**
     * Unauthorized
     */
    401: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Forbidden
     */
    403: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
    /**
     * Not found
     */
    404: {
        error: string;
        /**
         * Stable application error code, when available.
         */
        code?: string;
        details?: unknown;
    };
};

export type GetApiV1OrganizationsError = GetApiV1OrganizationsErrors[keyof GetApiV1OrganizationsErrors];

export type GetApiV1OrganizationsResponses = {
    /**
     * OK
     */
    200: {
        organizations: Array<{
            id: string;
            name: string;
            /**
             * URL slug used by the dashboard (`/cloud/{slug}`).
             */
            slug: string;
            /**
             * The caller's role: `owner`, `admin`, `member` or a custom role (comma-separated when several).
             */
            role: string;
        }>;
    };
};

export type GetApiV1OrganizationsResponse = GetApiV1OrganizationsResponses[keyof GetApiV1OrganizationsResponses];

export type GetSessionData = {
    body?: never;
    path?: never;
    query?: never;
    url: '/api/auth/get-session';
};

export type GetSessionErrors = {
    /**
     * Bad Request. Usually due to missing parameters, or invalid parameters.
     */
    400: {
        message: string;
    };
    /**
     * Unauthorized. Due to missing or invalid authentication.
     */
    401: {
        message: string;
    };
    /**
     * Forbidden. You do not have permission to access this resource or to perform this action.
     */
    403: {
        message?: string;
    };
    /**
     * Not Found. The requested resource was not found.
     */
    404: {
        message?: string;
    };
    /**
     * Too Many Requests. You have exceeded the rate limit. Try again later.
     */
    429: {
        message?: string;
    };
    /**
     * Internal Server Error. This is a problem with the server that you cannot fix.
     */
    500: {
        message?: string;
    };
};

export type GetSessionError = GetSessionErrors[keyof GetSessionErrors];

export type GetSessionResponses = {
    /**
     * Success
     */
    200: {
        user: {
            email: string;
        };
    } | null;
};

export type GetSessionResponse = GetSessionResponses[keyof GetSessionResponses];

export type PostApiAuthApiKeyCreateData = {
    body: {
        /**
         * The configuration ID to use for the API key. If not provided, the default configuration will be used.
         */
        configId?: string;
        /**
         * Name of the Api Key
         */
        name?: string;
        /**
         * Expiration time of the Api Key in seconds
         */
        expiresIn?: number | null;
        /**
         * Prefix of the Api Key
         */
        prefix?: string;
        metadata?: unknown;
        /**
         * Organization Id of the organization that the Api Key belongs to. Eg: 'org-id'
         */
        organizationId?: string;
    };
    path?: never;
    query?: never;
    url: '/api/auth/api-key/create';
};

export type PostApiAuthApiKeyCreateErrors = {
    /**
     * Bad Request. Usually due to missing parameters, or invalid parameters.
     */
    400: {
        message: string;
    };
    /**
     * Unauthorized. Due to missing or invalid authentication.
     */
    401: {
        message: string;
    };
    /**
     * Forbidden. You do not have permission to access this resource or to perform this action.
     */
    403: {
        message?: string;
    };
    /**
     * Not Found. The requested resource was not found.
     */
    404: {
        message?: string;
    };
    /**
     * Too Many Requests. You have exceeded the rate limit. Try again later.
     */
    429: {
        message?: string;
    };
    /**
     * Internal Server Error. This is a problem with the server that you cannot fix.
     */
    500: {
        message?: string;
    };
};

export type PostApiAuthApiKeyCreateError = PostApiAuthApiKeyCreateErrors[keyof PostApiAuthApiKeyCreateErrors];

export type PostApiAuthApiKeyCreateResponses = {
    /**
     * API key created successfully
     */
    200: {
        /**
         * Unique identifier of the API key
         */
        id: string;
        /**
         * The full API key (only returned on creation)
         */
        key: string;
        /**
         * Name of the API key
         */
        name?: string;
    };
};

export type PostApiAuthApiKeyCreateResponse = PostApiAuthApiKeyCreateResponses[keyof PostApiAuthApiKeyCreateResponses];

export type PostApiAuthApiKeyDeleteData = {
    body?: {
        /**
         * The id of the API key to delete
         */
        keyId: string;
    };
    path?: never;
    query?: never;
    url: '/api/auth/api-key/delete';
};

export type PostApiAuthApiKeyDeleteErrors = {
    /**
     * Bad Request. Usually due to missing parameters, or invalid parameters.
     */
    400: {
        message: string;
    };
    /**
     * Unauthorized. Due to missing or invalid authentication.
     */
    401: {
        message: string;
    };
    /**
     * Forbidden. You do not have permission to access this resource or to perform this action.
     */
    403: {
        message?: string;
    };
    /**
     * Not Found. The requested resource was not found.
     */
    404: {
        message?: string;
    };
    /**
     * Too Many Requests. You have exceeded the rate limit. Try again later.
     */
    429: {
        message?: string;
    };
    /**
     * Internal Server Error. This is a problem with the server that you cannot fix.
     */
    500: {
        message?: string;
    };
};

export type PostApiAuthApiKeyDeleteError = PostApiAuthApiKeyDeleteErrors[keyof PostApiAuthApiKeyDeleteErrors];

export type PostApiAuthApiKeyDeleteResponses = {
    /**
     * API key deleted successfully
     */
    200: {
        /**
         * Indicates if the API key was successfully deleted
         */
        success: boolean;
    };
};

export type PostApiAuthApiKeyDeleteResponse = PostApiAuthApiKeyDeleteResponses[keyof PostApiAuthApiKeyDeleteResponses];
>>>>>>> 2e222b3bb (feat(cli): generate the session, API key, organization and preference operations)
