export interface paths {
    "/api/auth/get-session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Get the current session */
        get: operations["getSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/api-key/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Create a new API key for a user */
        post: operations["postApiAuthApiKeyCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/api-key/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Delete an existing API key */
        post: operations["postApiAuthApiKeyDelete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description List the organizations the authenticated user is a member of, with their role, sorted by name. */
        get: operations["getApiV1Organizations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/user-preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Get preferences for the current user */
        get: operations["getApiV1UserPreferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
    "/api/v1/servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description List servers visible to the current user. Optional filter: organizationId. Supports offset list params: limit (default 50, max 100), skip, sort=field:asc|desc (fields: createdAt, updatedAt, name). */
        get: operations["getApiV1Servers"];
        put?: never;
        /** @description Create a server. JSON supports type="github" and type="external" for a direct customer-hosted URL. Multipart (Mango/Vibe/CLI) accepts a `sourceFile` tarball and GitHub deployment fields. */
        post: operations["postApiV1Servers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Get a single server by ID or slug. Includes deployments (last 10, without build logs) plus the active deployment if it is not in that window, domains (last 20), template, and deployment count. */
        get: operations["getApiV1ServersById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** @description Update a server. Returns the updated server as GET /servers/{id} does (domains, deployments, and the caller's credential per environment). */
        patch: operations["patchApiV1ServersById"];
        trace?: never;
    };
    "/api/v1/servers/{id}/source": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Mango/Vibe: push a new gzip tarball as a commit on the server's GitHub repo (redeploy). Multipart: sourceFile, branch, commitMessage. */
        post: operations["postApiV1ServersByIdSource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/github/installations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description List GitHub App installations for a given organization. Requires organizationId query parameter. Scoped to the backend's configured GITHUB_APP_ID — installations from other apps (e.g. dev vs prod) are excluded, since this backend can only read their repos. */
        get: operations["getApiV1GithubInstallations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/github/installations/{installationId}/repos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Create a new GitHub repository via the installation's Octokit client. Repos created by the app are automatically accessible to the installation. */
        post: operations["postApiV1GithubInstallationsByInstallationIdRepos"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/github/installations/{installationId}/repos/{owner}/{repo}/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Authoritative check for whether a GitHub App installation can access a specific repository. Uses a single `repos.get` call with the installation token (no pagination, no search-index lag), so it is reliable even for very large orgs and freshly created repositories. */
        get: operations["getApiV1GithubInstallationsByInstallationIdReposByOwnerByRepoAccess"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/env-variables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description List environment variables for a server (sensitive values masked). Optional `?branch=NAME` filters to that branch's rows; omit for production scope (branch IS NULL). */
        get: operations["getApiV1ServersByIdEnvVariables"];
        put?: never;
        /** @description Create an environment variable for a server */
        post: operations["postApiV1ServersByIdEnvVariables"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/env-variables/{varId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** @description Update an environment variable */
        patch: operations["patchApiV1ServersByIdEnvVariablesByVarId"];
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
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        user: {
                            email: string;
                        };
                    } | null;
                };
            };
            /** @description Bad Request. Usually due to missing parameters, or invalid parameters. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Unauthorized. Due to missing or invalid authentication. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Forbidden. You do not have permission to access this resource or to perform this action. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Not Found. The requested resource was not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Too Many Requests. You have exceeded the rate limit. Try again later. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Internal Server Error. This is a problem with the server that you cannot fix. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
        };
    };
    postApiAuthApiKeyCreate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The configuration ID to use for the API key. If not provided, the default configuration will be used. */
                    configId?: string;
                    /** @description Name of the Api Key */
                    name?: string;
                    /** @description Expiration time of the Api Key in seconds */
                    expiresIn?: number | null;
                    /** @description Prefix of the Api Key */
                    prefix?: string;
                    metadata?: unknown;
                    /** @description Organization Id of the organization that the Api Key belongs to. Eg: 'org-id' */
                    organizationId?: string;
                };
            };
        };
        responses: {
            /** @description API key created successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Unique identifier of the API key */
                        id: string;
                        /** @description The full API key (only returned on creation) */
                        key: string;
                        /** @description Name of the API key */
                        name?: string | null;
                    };
                };
            };
            /** @description Bad Request. Usually due to missing parameters, or invalid parameters. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Unauthorized. Due to missing or invalid authentication. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Forbidden. You do not have permission to access this resource or to perform this action. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Not Found. The requested resource was not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Too Many Requests. You have exceeded the rate limit. Try again later. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Internal Server Error. This is a problem with the server that you cannot fix. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
        };
    };
    postApiAuthApiKeyDelete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @description The id of the API key to delete */
                    keyId: string;
                };
            };
        };
        responses: {
            /** @description API key deleted successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Indicates if the API key was successfully deleted */
                        success: boolean;
                    };
                };
            };
            /** @description Bad Request. Usually due to missing parameters, or invalid parameters. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Unauthorized. Due to missing or invalid authentication. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Forbidden. You do not have permission to access this resource or to perform this action. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Not Found. The requested resource was not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Too Many Requests. You have exceeded the rate limit. Try again later. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
            /** @description Internal Server Error. This is a problem with the server that you cannot fix. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message?: string;
                    };
                };
            };
        };
    };
    getApiV1Organizations: {
        parameters: {
            query?: never;
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
                        organizations: {
                            id: string;
                            name: string;
                            /** @description URL slug used by the dashboard (`/cloud/{slug}`). */
                            slug: string;
                            /** @description The caller's role: `owner`, `admin`, `member` or a custom role (comma-separated when several). */
                            role: string;
                        }[];
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
    getApiV1UserPreferences: {
        parameters: {
            query?: never;
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
                        defaultOrganizationId: string | null;
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
    getApiV1Servers: {
        parameters: {
            query?: {
                organizationId?: string;
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
                            slug: string | null;
                            name: string | null;
                            organizationId: string;
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
    postApiV1Servers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @constant */
                    type: "github";
                    /** Format: uuid */
                    organizationId: string;
                    /** Format: uuid */
                    installationId?: string;
                    managed?: boolean;
                    name: string;
                    description?: string;
                    repoFullName?: string;
                    branch?: string;
                    rootDir?: string;
                    port?: number;
                    tags?: string[];
                    displayPreferences?: {
                        icon?: string;
                        color?: string;
                        inventory?: {
                            tools: number;
                            prompts: number;
                            resources: number;
                        };
                        catalog?: {
                            source?: string;
                            categories?: string[];
                            curated?: boolean;
                            tools?: string[];
                            prompts?: string[];
                            authorName?: string;
                            authorUrl?: string;
                            verifiedTier?: string;
                            worksWith?: string[];
                            documentation?: string;
                            authPosture?: string;
                        };
                    };
                    /** @enum {string} */
                    scaffoldTemplateId?: "mcp-server" | "mcp-apps" | "blank";
                    templateRepo?: string;
                    repoOwner?: string;
                    repoPrivate?: boolean;
                    buildCommand?: string;
                    startCommand?: string;
                    dockerfilePath?: string;
                    env?: {
                        [key: string]: string;
                    };
                    buildSecrets?: string[];
                    /** @enum {string} */
                    region?: "AUTO" | "US" | "EU" | "APAC" | "GLOBAL";
                    watchPaths?: string[];
                    waitForCi?: boolean;
                } | {
                    /** @constant */
                    type: "external";
                    /** Format: uuid */
                    organizationId: string;
                    name?: string;
                    description?: string;
                    /** Format: uri */
                    url: string;
                    auth?: {
                        /** @constant */
                        type: "bearer";
                        token: string;
                    } | {
                        /** @constant */
                        type: "headers";
                        headers: {
                            [key: string]: string;
                        };
                    };
                    headers?: {
                        [key: string]: string;
                    };
                    /** Format: uuid */
                    pendingCredentialAttemptId?: string;
                    tags?: string[];
                    displayPreferences?: {
                        icon?: string;
                        color?: string;
                        inventory?: {
                            tools: number;
                            prompts: number;
                            resources: number;
                        };
                        catalog?: {
                            source?: string;
                            categories?: string[];
                            curated?: boolean;
                            tools?: string[];
                            prompts?: string[];
                            authorName?: string;
                            authorUrl?: string;
                            verifiedTier?: string;
                            worksWith?: string[];
                            documentation?: string;
                            authPosture?: string;
                        };
                    };
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
                        server: {
                            id: string;
                            slug: string | null;
                        };
                        deploymentId: string | null;
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
    getApiV1ServersById: {
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
                        slug: string | null;
                        name: string | null;
                        organizationId: string;
                        isExternal: boolean;
                        connectedRepository?: {
                            isManaged: boolean;
                            productionBranch: string;
                        };
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
    patchApiV1ServersById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string;
                    slug?: string | null;
                    tags?: string[];
                    displayPreferences?: {
                        icon?: string;
                        color?: string;
                        inventory?: {
                            tools: number;
                            prompts: number;
                            resources: number;
                        };
                        catalog?: {
                            source?: string;
                            categories?: string[];
                            curated?: boolean;
                            tools?: string[];
                            prompts?: string[];
                            authorName?: string;
                            authorUrl?: string;
                            verifiedTier?: string;
                            worksWith?: string[];
                            documentation?: string;
                            authPosture?: string;
                        };
                    };
                    productionBranch?: string;
                    watchPaths?: string[];
                    deployBranchPatterns?: string[];
                    waitForCi?: boolean;
                    config?: {
                        url?: string | null;
                        transport?: string | null;
                        port?: number | null;
                        startCommand?: string | null;
                        buildCommand?: string | null;
                        rootDir?: string | null;
                        dockerfilePath?: string | null;
                        headers?: {
                            [key: string]: unknown;
                        } | null;
                        observabilityCapturePayloads?: boolean | null;
                        observabilityIdentifyActors?: boolean | null;
                        observabilityCaptureIntent?: boolean | null;
                        observabilityCaptureFeedback?: boolean | null;
                        rateLimitEnabled?: boolean | null;
                        discoverabilityMcpJsonEnabled?: boolean | null;
                        discoverabilityServerCardEnabled?: boolean | null;
                        rateLimitPerMinute?: number | null;
                        rateLimitExemptPlatforms?: ("claude" | "chatgpt" | "cursor" | "grok")[] | null;
                        /** @enum {string} */
                        checklistAutoRunMode?: "off" | "production" | "all-deployed" | "selected";
                        checklistAutoRunBranchPatterns?: string[];
                        checklistGitHubReportingEnabled?: boolean;
                        auth?: ({
                            type?: string;
                            /** @constant */
                            store?: "server-credentials";
                            access_token?: string;
                            /** @deprecated */
                            refresh_token?: string;
                            token_type?: string;
                            expires_at?: number;
                            scope?: string;
                            /** @deprecated */
                            token_endpoint?: string;
                            /** @deprecated */
                            client_id?: string;
                            /** @deprecated */
                            client_secret?: string;
                            /**
                             * Format: uri
                             * @deprecated
                             */
                            resource?: string;
                            /** @deprecated */
                            revision?: number;
                            updated_at?: string;
                            /** @deprecated */
                            refresh_status?: string;
                            /** @deprecated */
                            refresh_failed_at?: string;
                        } & {
                            [key: string]: unknown;
                        }) | null;
                    } & {
                        [key: string]: unknown;
                    };
                    replaceConfig?: boolean;
                    /** @enum {string} */
                    region?: "AUTO" | "US" | "EU" | "APAC" | "GLOBAL";
                    /** Format: uri */
                    externalUrl?: string;
                    /** Format: uuid */
                    pendingCredentialAttemptId?: string;
                    dashboardConnectionUrls?: {
                        [key: string]: ("" | string) | null;
                    };
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        slug: string | null;
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
    postApiV1ServersByIdSource: {
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
            /** @description Pushed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        commitSha: string;
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
    getApiV1GithubInstallations: {
        parameters: {
            query?: {
                organizationId?: string;
                includeInactive?: boolean | ("true" | "false");
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
                        installations: {
                            id: string;
                            installationId: string;
                            account: {
                                login: string;
                                type: string;
                            } | null;
                        }[];
                    };
                };
            };
            /** @description Missing organizationId */
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
    postApiV1GithubInstallationsByInstallationIdRepos: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @default true */
                    private?: boolean;
                    org?: string;
                };
            };
        };
        responses: {
            /** @description Repository created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        fullName: string;
                        cloneUrl: string;
                        htmlUrl: string;
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
    getApiV1GithubInstallationsByInstallationIdReposByOwnerByRepoAccess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installationId: string;
                owner: string;
                repo: string;
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
                        hasAccess: boolean;
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
    getApiV1ServersByIdEnvVariables: {
        parameters: {
            query?: {
                branch?: string;
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
                        id: string;
                        key: string;
                        branch: string | null;
                        environments: string[];
                    }[];
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
    postApiV1ServersByIdEnvVariables: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    key: string;
                    value: string;
                    /**
                     * @default [
                     *       "production"
                     *     ]
                     */
                    environments?: ("production" | "preview" | "development")[];
                    /**
                     * @default both
                     * @enum {string}
                     */
                    phase?: "runtime" | "build" | "both";
                    /** @default false */
                    sensitive?: boolean;
                    branch?: string | null;
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
    patchApiV1ServersByIdEnvVariablesByVarId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                varId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    value?: string | null;
                    environments?: ("production" | "preview" | "development")[];
                    /** @enum {string} */
                    phase?: "runtime" | "build" | "both";
                    sensitive?: boolean;
                    branch?: string | null;
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
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
