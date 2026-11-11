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
        /** @description Delete a deployment and tear down its infrastructure */
        delete: operations["deleteApiV1DeploymentsById"];
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
        /** @description Delete a server and all its deployments */
        delete: operations["deleteApiV1ServersById"];
        options?: never;
        head?: never;
        /** @description Update a server. Returns the updated server as GET /servers/{id} does (domains, deployments, and the caller's credential per environment). */
        patch: operations["patchApiV1ServersById"];
        trace?: never;
    };
    "/api/v1/servers/{id}/analytics/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Analytics catalog for this server: relations and columns, measures (with approximation bounds and SQL per relation), dimensions, segments, limits, plan retention and worked examples. Requires server:read. */
        get: operations["getApiV1ServersByIdAnalyticsCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/analytics/sql": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Read-only ClickHouse SQL over this server's analytics relations (see the catalog). One SELECT per request; tenancy and plan retention are enforced inside ClickHouse. At most 2 SQL requests run at once per organization: a third waits up to 2.5 s, then answers 429 with details. Requires server:read. */
        post: operations["postApiV1ServersByIdAnalyticsSql"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
        /** @description List repositories accessible to a GitHub App installation. */
        get: operations["getApiV1GithubInstallationsByInstallationIdRepos"];
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
        /** @description Delete an environment variable */
        delete: operations["deleteApiV1ServersByIdEnvVariablesByVarId"];
        options?: never;
        head?: never;
        /** @description Update an environment variable */
        patch: operations["patchApiV1ServersByIdEnvVariablesByVarId"];
        trace?: never;
    };
    "/api/v1/servers/{id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Durable build and/or runtime logs for a server over a time range, read from ClickHouse. Filter by `type` (build|runtime), `deploymentId`, and `start`/`end` (defaults to the last 24h). */
        get: operations["getApiV1ServersByIdLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/deployments/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Promote a deployment to be the active (production) deployment for its server. Updates gateway routing, server config, and tears down the previous production deployment. */
        post: operations["postApiV1DeploymentsByIdActivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/deployments/{id}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Stop a running deployment */
        post: operations["postApiV1DeploymentsByIdStop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/repository": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** @description Connect or reconnect a GitHub repository to an existing hosted server in place. Does not start a deployment; use Deploy or push to ship. */
        put: operations["putApiV1ServersByIdRepository"];
        post?: never;
        /** @description Disconnect the server's GitHub repository. The running server stays online; automatic and manual deploys are paused until a repository is reconnected. */
        delete: operations["deleteApiV1ServersByIdRepository"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/gateway/ip-access": {
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
        /** @description Create/update IP access config for a server. Pushes changes to the gateway KV immediately. */
        patch: operations["patchApiV1ServersByIdGatewayIpAccess"];
        trace?: never;
    };
    "/api/auth/organization/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Create an organization */
        post: operations["postApiAuthOrganizationCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/organization/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Update an organization */
        post: operations["postApiAuthOrganizationUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{id}/logo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Upload or replace the organization logo. Accepts multipart/form-data with a single `file` field (PNG, JPEG, WebP, GIF; max 2 MB). Returns the public URL of the uploaded image. */
        post: operations["postApiV1OrganizationsByIdLogo"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/alerts/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiV1ServersByIdAlertsOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/alerts/rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiV1ServersByIdAlertsRules"];
        put?: never;
        post: operations["postApiV1ServersByIdAlertsRules"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/alerts/rules/{ruleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiV1ServersByIdAlertsRulesByRuleId"];
        put: operations["putApiV1ServersByIdAlertsRulesByRuleId"];
        post?: never;
        delete: operations["deleteApiV1ServersByIdAlertsRulesByRuleId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description List the members of an organization with their user profile, oldest first by default. Any member may list. */
        get: operations["getApiV1OrganizationsByIdMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{id}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description List every invitation of an organization (all statuses), newest first. Any member may list. */
        get: operations["getApiV1OrganizationsByIdInvitations"];
        put?: never;
        /** @description Invite someone to an organization by email and send the invitation email. Requires the `invitation:create` permission. Callers cannot invite above their own role (only owners invite owners), and custom roles need the Enterprise plan. With `resend`, an existing pending invitation is extended and its email sent again. */
        post: operations["postApiV1OrganizationsByIdInvitations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{id}/invitations/{invitationId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Cancel an invitation of the organization. Requires the `invitation:cancel` permission. Returns the canceled invitation. */
        post: operations["postApiV1OrganizationsByIdInvitationsByInvitationIdCancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/domain/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Get custom domain status for a server */
        get: operations["getApiV1ServersByIdDomainStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/domain/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Request a custom domain. HTTP validation returns CNAME instructions. TXT validation returns ownership and certificate records to prepare HTTPS before DNS cutover; call verify with activate=true when ready to activate. */
        post: operations["postApiV1ServersByIdDomainRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/domain/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Check hostname and certificate validation, or explicitly switch a pending domain to TXT with validationMethod=txt and domainId. TXT preparation stays staged until activate=true is explicitly supplied. Pending checks return current DNS validation records. */
        post: operations["postApiV1ServersByIdDomainVerify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/servers/{id}/domain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** @description Remove custom domain from a server */
        delete: operations["deleteApiV1ServersByIdDomain"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/github/connect-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Mint a GitHub App install URL carrying a short-lived signed `state` that binds the install to the current user + organization. Used by the in-chat connect_github flow so the install can complete in a fresh browser tab (no session) and link back via /installations/callback-by-state. */
        get: operations["getApiV1GithubConnectUrl"];
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
    schemas: {
        AlertRuleCondition0: components["schemas"]["AlertRuleComparison"] | {
            all: components["schemas"]["AlertRuleCondition1"][];
        } | {
            any: components["schemas"]["AlertRuleCondition1"][];
        };
        AlertRuleComparison: {
            /** @enum {string} */
            metric: "cpu.busyPercent" | "cpu.stealPercent" | "memory.usagePercent" | "request.requests" | "request.errors" | "request.errorPercent" | "request.reachabilityRequests" | "request.reachableRequests" | "request.unreachablePercent" | "deployment.failedCount" | "deployment.latestOpenFailureAtMs" | "runtime.serving" | "tool.calls" | "tool.errors" | "tool.errorPercent" | "authentication.requests" | "authentication.rejections" | "authentication.rejectionPercent" | "token.requests" | "token.errorPercent" | "token.latencyP95Ms";
            /** @enum {string} */
            op: "gt" | "gte" | "lt" | "lte" | "eq" | "ne";
            value: number;
        };
        AlertRuleCondition1: components["schemas"]["AlertRuleComparison"] | {
            all: components["schemas"]["AlertRuleCondition2"][];
        } | {
            any: components["schemas"]["AlertRuleCondition2"][];
        };
        AlertRuleCondition2: components["schemas"]["AlertRuleComparison"] | {
            all: components["schemas"]["AlertRuleComparison"][];
        } | {
            any: components["schemas"]["AlertRuleComparison"][];
        };
    };
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
    deleteApiV1DeploymentsById: {
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
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        success: boolean;
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
                            status: string;
                            mcpUrl: string;
                            dashboardUrl: string;
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
                            repoFullName: string | null;
                            githubInstallationId: string;
                            watchPaths: string[];
                            deployBranchPatterns: string[];
                            waitForCi: boolean;
                        };
                        description: string | null;
                        status: string;
                        mcpUrl: string;
                        dashboardUrl: string;
                        /** @enum {string} */
                        publicRoutingMode: "direct" | "gateway";
                        /** @enum {string} */
                        region: "AUTO" | "US" | "EU" | "APAC" | "GLOBAL";
                        activeDeploymentId: string | null;
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
    deleteApiV1ServersById: {
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
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        success: boolean;
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
                    productionBranch?: string;
                    watchPaths?: string[];
                    deployBranchPatterns?: string[];
                    waitForCi?: boolean;
                    config?: {
                        rootDir?: string | null;
                        buildCommand?: string | null;
                        startCommand?: string | null;
                    } & {
                        [key: string]: unknown;
                    };
                    slug?: string | null;
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
                        name: string | null;
                        organizationId: string;
                        description: string | null;
                        status: string;
                        mcpUrl: string;
                        dashboardUrl: string;
                        /** @enum {string} */
                        publicRoutingMode: "direct" | "gateway";
                        /** @enum {string} */
                        region: "AUTO" | "US" | "EU" | "APAC" | "GLOBAL";
                        activeDeploymentId: string | null;
                        connectedRepository?: {
                            repoFullName: string | null;
                            productionBranch: string;
                            githubInstallationId: string;
                            watchPaths: string[];
                            deployBranchPatterns: string[];
                            waitForCi: boolean;
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
    getApiV1ServersByIdAnalyticsCatalog: {
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
                        catalogVersion: string;
                        /** @constant */
                        dialect: "clickhouse";
                        relations: {
                            /** @enum {string} */
                            name: "events" | "metrics_hourly" | "metrics_daily" | "sessions_daily" | "sessions_hourly" | "clients_daily" | "tool_health_daily" | "tool_interactions" | "actors_hourly" | "actors_daily";
                            description: string;
                            grain: string;
                            timeColumn: string;
                            ttlDays: number;
                            rowBudget: number | null;
                            columns: {
                                name: string;
                                type: string;
                                kind: string;
                                description: string;
                            }[];
                        }[];
                        measures: {
                            /**
                             * @description Measure. ≈ = approximate (sketch). events (count): Events (requests); tool_calls (count): tools/call events; errors (count): Error events: transport errors plus failed tool results; error_rate (ratio): errors / events (0..1); transport_errors (count): HTTP/transport errors, excluding neutral lifecycle signals; tool_result_errors (count): tools/call results with isError; tool_outcome_events (count): Events with a known tool outcome (tool_call_success not NULL); tool_result_error_rate (ratio): tool_result_errors / tool_outcome_events (0..1); neutral_events (count): Expected capability signals (optional SSE 405, protocol probe); success_events (count): Successful events; avg_duration_ms (ms): Mean duration_ms over events with a duration; min_duration_ms (ms): Minimum duration_ms; max_duration_ms (ms): Maximum duration_ms; p50_duration_ms (ms, ≈): p50 of duration_ms (t-digest); p90_duration_ms (ms, ≈): p90 of duration_ms (t-digest); p95_duration_ms (ms, ≈): p95 of duration_ms (t-digest); p99_duration_ms (ms, ≈): p99 of duration_ms (t-digest); sessions (count, ≈): Distinct sessions (interaction_id); actors (count, ≈): Distinct actors; verified_actors (count, ≈): Distinct actors identified by conversation, token or account; approximate_actors (count, ≈): Distinct IP-derived actors; output_tokens (tokens): Sum of estimated output tokens; token_events (count): Events with an output token estimate; avg_request_bytes (bytes): Mean request body bytes; avg_response_bytes (bytes): Mean response body bytes; sessions_with_tool (count): Distinct sessions with at least one matching tools/call (exact, tool index); active_interactions_5m (count): Distinct sessions with an event in the last 5 minutes (exact, raw); first_seen (timestamp): First event time; last_seen (timestamp): Last event time
                             * @enum {string}
                             */
                            name: "events" | "tool_calls" | "errors" | "error_rate" | "transport_errors" | "tool_result_errors" | "tool_outcome_events" | "tool_result_error_rate" | "neutral_events" | "success_events" | "avg_duration_ms" | "min_duration_ms" | "max_duration_ms" | "p50_duration_ms" | "p90_duration_ms" | "p95_duration_ms" | "p99_duration_ms" | "sessions" | "actors" | "verified_actors" | "approximate_actors" | "output_tokens" | "token_events" | "avg_request_bytes" | "avg_response_bytes" | "sessions_with_tool" | "active_interactions_5m" | "first_seen" | "last_seen";
                            description: string;
                            /** @enum {string} */
                            unit: "count" | "ratio" | "ms" | "tokens" | "bytes" | "timestamp";
                            type: string;
                            errorBound: string | null;
                            /** @enum {string} */
                            accuracy: "exact" | "approx";
                            sources: ("events" | "metrics_hourly" | "metrics_daily" | "sessions_daily" | "sessions_hourly" | "clients_daily" | "tool_health_daily" | "tool_interactions" | "actors_hourly" | "actors_daily")[];
                            sql: {
                                [key: string]: string;
                            };
                        }[];
                        dimensions: {
                            /**
                             * @description Dimension. mcp_method: JSON-RPC method (tools/call, tools/list, initialize, ...); method_family: First path segment of the method (tools, resources, prompts, initialize, ...); resource: Breakdown key: resource_name, else resource_type, else the method (tool-breakdown card); health_resource: Health key: resource_name, else the method (health card); resource_name: Tool, prompt or resource name the method targets (resources/* URIs: credentials redacted); resource_type: tool, prompt or resource; tool: Tool name of tools/call events (NULL for other methods); client_name: MCP client display name from initialize ('Unknown Client' when missing); client_version: MCP client version ('unknown' when missing); protocol_version: Negotiated MCP protocol version ('unknown' when missing); country: Caller country, ISO 3166-1 alpha-2 ('Unknown' when missing); subdomain: Gateway subdomain: the server slug for production, <slug>--br-<branch> for previews; http_method: HTTP method; status: success or error; status_code: HTTP status code; error_code: JSON-RPC error code; transport_error_kind: Transport failure class; transport_mode: Transport (streamable-http, sse, ...); auth_method: How the caller authenticated; actor_source: How actor_id was derived (sdk-conversation, auth-token, openai-subject, platform-user, ip-anon); actor_trust: verified (person or conversation), approximate (IP-derived) or none; traffic_class: non_mcp, discovery, allowlisted or other_mcp; actor_id (raw events only): Org-salted actor hash (linkable across servers of one organization); interaction_id (raw events only): Session (interaction) id: one conversation or connection; error_reason (raw events only): Error message with secrets redacted (at most 500 characters); deployment_id (raw events only): Deployment that served the request
                             * @enum {string}
                             */
                            name: "mcp_method" | "method_family" | "resource" | "health_resource" | "resource_name" | "resource_type" | "tool" | "client_name" | "client_version" | "protocol_version" | "country" | "subdomain" | "http_method" | "status" | "status_code" | "error_code" | "transport_error_kind" | "transport_mode" | "auth_method" | "actor_source" | "actor_trust" | "traffic_class" | "actor_id" | "interaction_id" | "error_reason" | "deployment_id";
                            description: string;
                            type: string;
                            rawOnly: boolean;
                            sources: ("events" | "metrics_hourly" | "metrics_daily" | "sessions_daily" | "sessions_hourly" | "clients_daily" | "tool_health_daily" | "tool_interactions" | "actors_hourly" | "actors_daily")[];
                        }[];
                        segments: {
                            /**
                             * @description Traffic segment (ANDed; default mcp_traffic). mcp_traffic: Parsed MCP requests (the default): excludes non-MCP HTTP and 'unknown'; method_allowlist: tools/*, resources/*, prompts/*, notifications/*, logging/*, sampling/*, completion/*, elicitation/* and initialize; non_discovery: method_allowlist without discovery (*\/list) and subscription bookkeeping; all: Every event, including non-MCP HTTP (the timeline card)
                             * @enum {string}
                             */
                            name: "mcp_traffic" | "method_allowlist" | "non_discovery" | "all";
                            description: string;
                            default: boolean;
                        }[];
                        branches: {
                            branch: string;
                            subdomain: string;
                        }[];
                        /** @description API limits; admission: per-org pools */
                        limits: {
                            [key: string]: number | string | {
                                [key: string]: {
                                    [key: string]: number;
                                };
                            };
                        };
                        retention: {
                            days: number | "unlimited";
                            floor: string;
                        };
                        rawWindowHintDays: number | null;
                        freshness: {
                            maxIngestedAt: string | null;
                            /** @description Now minus maxIngestedAt, at response time */
                            lagSeconds: number | null;
                            /** @description When maxIngestedAt was read (cached up to 10 minutes) */
                            asOf: string;
                        } | null;
                        notes: string[];
                        examples: {
                            question: string;
                            metricsQuery: {
                                /** @description Half-open UTC window [from, to), to <= now; the start is clamped to the plan's retention. */
                                window: {
                                    /** @enum {string} */
                                    preset: "1h" | "24h" | "7d" | "30d" | "90d";
                                } | {
                                    /** Format: date-time */
                                    from: string;
                                    /** Format: date-time */
                                    to: string;
                                };
                                measures: ("events" | "tool_calls" | "errors" | "error_rate" | "transport_errors" | "tool_result_errors" | "tool_outcome_events" | "tool_result_error_rate" | "neutral_events" | "success_events" | "avg_duration_ms" | "min_duration_ms" | "max_duration_ms" | "p50_duration_ms" | "p90_duration_ms" | "p95_duration_ms" | "p99_duration_ms" | "sessions" | "actors" | "verified_actors" | "approximate_actors" | "output_tokens" | "token_events" | "avg_request_bytes" | "avg_response_bytes" | "sessions_with_tool" | "active_interactions_5m" | "first_seen" | "last_seen")[];
                                dimensions?: ("mcp_method" | "method_family" | "resource" | "health_resource" | "resource_name" | "resource_type" | "tool" | "client_name" | "client_version" | "protocol_version" | "country" | "subdomain" | "http_method" | "status" | "status_code" | "error_code" | "transport_error_kind" | "transport_mode" | "auth_method" | "actor_source" | "actor_trust" | "traffic_class" | "actor_id" | "interaction_id" | "error_reason" | "deployment_id")[];
                                /**
                                 * @description Bucket size; omit for totals. auto: the finest of hour/day/week/month with at most 240 buckets. Past 1500 buckets (or minute over 6h) the next coarser size is served (meta.granularity). Weeks start on Monday.
                                 * @enum {string}
                                 */
                                granularity?: "minute" | "hour" | "day" | "week" | "month" | "auto";
                                filters?: {
                                    /**
                                     * @description Dimension. mcp_method: JSON-RPC method (tools/call, tools/list, initialize, ...); method_family: First path segment of the method (tools, resources, prompts, initialize, ...); resource: Breakdown key: resource_name, else resource_type, else the method (tool-breakdown card); health_resource: Health key: resource_name, else the method (health card); resource_name: Tool, prompt or resource name the method targets (resources/* URIs: credentials redacted); resource_type: tool, prompt or resource; tool: Tool name of tools/call events (NULL for other methods); client_name: MCP client display name from initialize ('Unknown Client' when missing); client_version: MCP client version ('unknown' when missing); protocol_version: Negotiated MCP protocol version ('unknown' when missing); country: Caller country, ISO 3166-1 alpha-2 ('Unknown' when missing); subdomain: Gateway subdomain: the server slug for production, <slug>--br-<branch> for previews; http_method: HTTP method; status: success or error; status_code: HTTP status code; error_code: JSON-RPC error code; transport_error_kind: Transport failure class; transport_mode: Transport (streamable-http, sse, ...); auth_method: How the caller authenticated; actor_source: How actor_id was derived (sdk-conversation, auth-token, openai-subject, platform-user, ip-anon); actor_trust: verified (person or conversation), approximate (IP-derived) or none; traffic_class: non_mcp, discovery, allowlisted or other_mcp; actor_id (raw events only): Org-salted actor hash (linkable across servers of one organization); interaction_id (raw events only): Session (interaction) id: one conversation or connection; error_reason (raw events only): Error message with secrets redacted (at most 500 characters); deployment_id (raw events only): Deployment that served the request
                                     * @enum {string}
                                     */
                                    dimension: "mcp_method" | "method_family" | "resource" | "health_resource" | "resource_name" | "resource_type" | "tool" | "client_name" | "client_version" | "protocol_version" | "country" | "subdomain" | "http_method" | "status" | "status_code" | "error_code" | "transport_error_kind" | "transport_mode" | "auth_method" | "actor_source" | "actor_trust" | "traffic_class" | "actor_id" | "interaction_id" | "error_reason" | "deployment_id";
                                    /** @enum {string} */
                                    op: "eq" | "neq" | "in" | "not_in" | "like";
                                    values: string[];
                                }[];
                                segments?: ("mcp_traffic" | "method_allowlist" | "non_discovery" | "all")[];
                                /** @description Include Manufact's own clients (default false; forced by an eq/in client_name filter). */
                                includeInternal?: boolean;
                                /** @description Sessions using these tools */
                                sessionTools?: string[];
                                /** @description Preview branch; omit for all environments. */
                                branch?: string;
                                /** @constant */
                                compare?: "previous_period";
                                topN?: {
                                    /**
                                     * @description Dimension. mcp_method: JSON-RPC method (tools/call, tools/list, initialize, ...); method_family: First path segment of the method (tools, resources, prompts, initialize, ...); resource: Breakdown key: resource_name, else resource_type, else the method (tool-breakdown card); health_resource: Health key: resource_name, else the method (health card); resource_name: Tool, prompt or resource name the method targets (resources/* URIs: credentials redacted); resource_type: tool, prompt or resource; tool: Tool name of tools/call events (NULL for other methods); client_name: MCP client display name from initialize ('Unknown Client' when missing); client_version: MCP client version ('unknown' when missing); protocol_version: Negotiated MCP protocol version ('unknown' when missing); country: Caller country, ISO 3166-1 alpha-2 ('Unknown' when missing); subdomain: Gateway subdomain: the server slug for production, <slug>--br-<branch> for previews; http_method: HTTP method; status: success or error; status_code: HTTP status code; error_code: JSON-RPC error code; transport_error_kind: Transport failure class; transport_mode: Transport (streamable-http, sse, ...); auth_method: How the caller authenticated; actor_source: How actor_id was derived (sdk-conversation, auth-token, openai-subject, platform-user, ip-anon); actor_trust: verified (person or conversation), approximate (IP-derived) or none; traffic_class: non_mcp, discovery, allowlisted or other_mcp; actor_id (raw events only): Org-salted actor hash (linkable across servers of one organization); interaction_id (raw events only): Session (interaction) id: one conversation or connection; error_reason (raw events only): Error message with secrets redacted (at most 500 characters); deployment_id (raw events only): Deployment that served the request
                                     * @enum {string}
                                     */
                                    dimension: "mcp_method" | "method_family" | "resource" | "health_resource" | "resource_name" | "resource_type" | "tool" | "client_name" | "client_version" | "protocol_version" | "country" | "subdomain" | "http_method" | "status" | "status_code" | "error_code" | "transport_error_kind" | "transport_mode" | "auth_method" | "actor_source" | "actor_trust" | "traffic_class" | "actor_id" | "interaction_id" | "error_reason" | "deployment_id";
                                    n: number;
                                    otherLabel?: string;
                                };
                                orderBy?: {
                                    field: string;
                                    /** @enum {string} */
                                    dir: "asc" | "desc";
                                }[];
                                limit?: number;
                                zeroFill?: boolean;
                                /**
                                 * @description exact: raw events, within the raw budget
                                 * @enum {string}
                                 */
                                accuracy?: "auto" | "exact";
                            } | null;
                            sql: string;
                        }[];
                    };
                };
            };
            /** @description ANALYTICS_QUERY_INVALID / ANALYTICS_SQL_REJECTED / VALIDATION_ERROR */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
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
            /** @description ANALYTICS_QUERY_TIMEOUT: timed out or cancelled */
            408: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
            /** @description ANALYTICS_RESULT_TOO_LARGE */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
            /** @description ANALYTICS_QUERY_BUDGET (see details) / ANALYTICS_TIME_RANGE_UNAVAILABLE */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
            /** @description ANALYTICS_QUERY_RATE_LIMIT (honour Retry-After) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
            /** @description ANALYTICS_UNAVAILABLE (retry once) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
        };
    };
    postApiV1ServersByIdAnalyticsSql: {
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
                    /** @description One ClickHouse SELECT (or UNION) over the analytics relations: events: Raw gateway events, one row per request. Drill-down only: each query may read at most 20M rows (about one day of the busiest server). Use the rollups for aggregates. metrics_hourly: Hourly cube of every event ingredient (100 days). Additive columns are sums: use sum(events), never count(). Sketch columns need their -Merge function. metrics_daily: Daily cube of every event ingredient (400 days), same columns as metrics_hourly. sessions_daily: Narrow daily rollup for headline sessions and actors by client, country and branch. Segments map to traffic_class. sessions_hourly: Narrow hourly rollup for headline sessions and actors by client and branch (100 days, no country). Prefer it to metrics_hourly for windows up to 2 days. clients_daily: Narrow daily rollup for headline sessions, actors and latency by client, client and protocol version and branch (no country). The narrowest daily relation for headline numbers. tool_health_daily: Narrow daily rollup for per-tool and per-client health and tokens: error classes, latency digests and output tokens by method, resource and client. tool_interactions: Exact tool index: one row per (server, tool, hour, interaction). Answers 'sessions that used tool X' exactly at any window: uniqExact(interaction_id). actors_hourly: Account or token actor activity on tools/call events, by client, tool and branch. Full-period user rankings use sums and merged session sketches. actors_daily: Account or token actor activity on tools/call events, by client, tool and branch. Full-period user rankings use sums and merged session sketches. */
                    sql: string;
                    /** @description Default 7d; bound as {from} and {to}. */
                    timeRange?: {
                        /** @enum {string} */
                        preset: "1h" | "24h" | "7d" | "30d" | "90d";
                    } | {
                        /** Format: date-time */
                        from: string;
                        /** Format: date-time */
                        to: string;
                    };
                    branch?: string;
                    includeInternal?: boolean;
                    maxRows?: number;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        queryId: string;
                        columns: {
                            name: string;
                            type: string;
                        }[];
                        /** @description JSONCompact rows; 64-bit integers are strings. */
                        rows: unknown[][];
                        truncated: boolean;
                        statistics: {
                            elapsedMs: number;
                            rowsRead: number;
                            bytesRead: number;
                        };
                        meta: {
                            catalogVersion: string;
                            retentionFloor: string;
                            /** @enum {string} */
                            admissionClass: "light" | "heavy";
                            rawWindowHintDays: number | null;
                            freshness: {
                                maxIngestedAt: string | null;
                                /** @description Now minus maxIngestedAt, at response time */
                                lagSeconds: number | null;
                                /** @description When maxIngestedAt was read (cached up to 10 minutes) */
                                asOf: string;
                            } | null;
                        };
                    };
                };
            };
            /** @description ANALYTICS_QUERY_INVALID / ANALYTICS_SQL_REJECTED / VALIDATION_ERROR */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
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
            /** @description ANALYTICS_QUERY_TIMEOUT: timed out or cancelled */
            408: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
            /** @description ANALYTICS_RESULT_TOO_LARGE */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
            /** @description ANALYTICS_QUERY_BUDGET (see details) / ANALYTICS_TIME_RANGE_UNAVAILABLE */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
            /** @description ANALYTICS_QUERY_RATE_LIMIT (honour Retry-After) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
                    };
                };
            };
            /** @description ANALYTICS_UNAVAILABLE (retry once) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        code: string;
                        details?: {
                            [key: string]: unknown;
                        };
                        status?: number;
                        queryId?: string;
                        hint?: string;
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
                            organizationId: string | null;
                            isActive: boolean;
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
    getApiV1GithubInstallationsByInstallationIdRepos: {
        parameters: {
            query?: {
                page?: number;
                perPage?: number;
                q?: string;
            };
            header?: never;
            path: {
                installationId: string;
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
                        repos: {
                            id: number;
                            name: string;
                            fullName: string;
                            private: boolean;
                            htmlUrl: string;
                            defaultBranch: string | null;
                            pushedAt: string | null;
                            ownerAvatarUrl: string | null;
                        }[];
                        page: number;
                        perPage: number;
                        totalCount: number;
                        hasMore: boolean;
                        /** @enum {string} */
                        mode: "browse" | "search";
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
                        serverId: string;
                        phase: string;
                        sensitive: boolean;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        updatedAt: string;
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
                        serverId: string;
                        key: string;
                        environments: string[];
                        phase: string;
                        sensitive: boolean;
                        branch: string | null;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        updatedAt: string;
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
    deleteApiV1ServersByIdEnvVariablesByVarId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                varId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        success: boolean;
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
                        serverId: string;
                        key: string;
                        environments: string[];
                        phase: string;
                        sensitive: boolean;
                        branch: string | null;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        updatedAt: string;
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
    getApiV1ServersByIdLogs: {
        parameters: {
            query?: {
                type?: "build" | "runtime";
                start?: string;
                end?: string;
                deploymentId?: string;
                limit?: number;
                order?: "asc" | "desc";
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
                        logs: {
                            /** Format: date-time */
                            time: string;
                            /** @enum {string} */
                            logType: "build" | "runtime";
                            deploymentId: string | null;
                            appName: string | null;
                            level: string | null;
                            region: string | null;
                            instanceId: string | null;
                            message: string;
                        }[];
                        window: {
                            /** Format: date-time */
                            start: string;
                            /** Format: date-time */
                            end: string;
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
    postApiV1DeploymentsByIdActivate: {
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
            /** @description Activated */
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
            /** @description Deployment cannot be activated (not running or missing hostname) */
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
    postApiV1DeploymentsByIdStop: {
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
            /** @description Stopped */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        success: boolean;
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
    putApiV1ServersByIdRepository: {
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
                    /** Format: uuid */
                    installationId: string;
                    repoFullName: string;
                    /** @default main */
                    productionBranch?: string;
                    rootDir?: string;
                };
            };
        };
        responses: {
            /** @description Connected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        server: {
                            id: string;
                            name: string | null;
                            slug: string | null;
                        };
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
    deleteApiV1ServersByIdRepository: {
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
            /** @description Disconnected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
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
    patchApiV1ServersByIdGatewayIpAccess: {
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
                    enabled?: boolean;
                    customCidrs?: string[];
                    chatgptPreset?: boolean;
                    anthropicPreset?: boolean;
                    cursorPreset?: boolean;
                    grokPreset?: boolean;
                    manufactPreset?: boolean;
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
                        hasConfig: boolean;
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
    postApiAuthOrganizationCreate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The name of the organization */
                    name: string;
                    /** @description The slug of the organization */
                    slug: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        readonly id: string;
                        name: string;
                        slug: string;
                        logo?: string;
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
    postApiAuthOrganizationUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The organization ID. Eg: "org-id" */
                    organizationId?: string;
                    data: {
                        /** @description The name of the organization */
                        name?: string;
                        /** @description The slug of the organization */
                        slug?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        readonly id: string;
                        name: string;
                        slug: string;
                        logo?: string;
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
    postApiV1OrganizationsByIdLogo: {
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
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description Logo uploaded */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        url: string;
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
            /** @description Internal error */
            500: {
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
    getApiV1ServersByIdAlertsOptions: {
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
                        metrics: {
                            name: string;
                            description: string;
                        }[];
                        evaluationIntervalMs: number;
                        maxDurationMs: number;
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
    getApiV1ServersByIdAlertsRules: {
        parameters: {
            query?: {
                search?: string;
                status?: "active" | "recovering" | "unknown" | "resolved" | "paused";
                templateId?: string;
                offset?: number;
                limit?: number;
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
                        total: number;
                        rules: {
                            id: string;
                            revision: number;
                            config: {
                                name: string;
                                description?: string;
                                enabled: boolean;
                                trigger: {
                                    when: components["schemas"]["AlertRuleCondition0"];
                                    for: string;
                                };
                                recover: {
                                    description?: string;
                                    name?: string;
                                    when: components["schemas"]["AlertRuleCondition0"];
                                    for: string;
                                };
                                notify: ({
                                    /** @constant */
                                    type: "email";
                                    recipients?: string[];
                                } | {
                                    /** @constant */
                                    type: "slack";
                                    channel?: string;
                                })[];
                            };
                            /** @enum {string} */
                            status: "active" | "recovering" | "unknown" | "resolved" | "paused";
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
    postApiV1ServersByIdAlertsRules: {
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
                    config: {
                        name: string;
                        description?: string;
                        enabled: boolean;
                        /** @enum {string} */
                        audience: "customer";
                        targets: {
                            serverIds: string[];
                        };
                        trigger: {
                            when: components["schemas"]["AlertRuleCondition0"];
                            for: string;
                        };
                        recover: {
                            description?: string;
                            name?: string;
                            when: components["schemas"]["AlertRuleCondition0"];
                            for: string;
                        };
                        notify: ({
                            /** @constant */
                            type: "email";
                            recipients?: string[];
                        } | {
                            /** @constant */
                            type: "slack";
                            channel?: string;
                        })[];
                    };
                    reason: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rule: {
                            id: string;
                            revision: number;
                            config: {
                                name: string;
                                description?: string;
                                enabled: boolean;
                                trigger: {
                                    when: components["schemas"]["AlertRuleCondition0"];
                                    for: string;
                                };
                                recover: {
                                    description?: string;
                                    name?: string;
                                    when: components["schemas"]["AlertRuleCondition0"];
                                    for: string;
                                };
                                notify: ({
                                    /** @constant */
                                    type: "email";
                                    recipients?: string[];
                                } | {
                                    /** @constant */
                                    type: "slack";
                                    channel?: string;
                                })[];
                            };
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
    getApiV1ServersByIdAlertsRulesByRuleId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                ruleId: string;
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
                        rule: {
                            id: string;
                            revision: number;
                            config: {
                                name: string;
                                description?: string;
                                enabled: boolean;
                                trigger: {
                                    when: components["schemas"]["AlertRuleCondition0"];
                                    for: string;
                                };
                                recover: {
                                    description?: string;
                                    name?: string;
                                    when: components["schemas"]["AlertRuleCondition0"];
                                    for: string;
                                };
                                notify: ({
                                    /** @constant */
                                    type: "email";
                                    recipients?: string[];
                                } | {
                                    /** @constant */
                                    type: "slack";
                                    channel?: string;
                                })[];
                            };
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
    putApiV1ServersByIdAlertsRulesByRuleId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                ruleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    config: {
                        id?: string;
                        name: string;
                        description?: string;
                        enabled: boolean;
                        /** @enum {string} */
                        audience: "customer";
                        targets: {
                            serverIds: string[];
                        };
                        trigger: {
                            when: components["schemas"]["AlertRuleCondition0"];
                            for: string;
                        };
                        recover: {
                            description?: string;
                            name?: string;
                            when: components["schemas"]["AlertRuleCondition0"];
                            for: string;
                        };
                        notify: ({
                            /** @constant */
                            type: "email";
                            recipients?: string[];
                        } | {
                            /** @constant */
                            type: "slack";
                            channel?: string;
                        })[];
                    };
                    reason: string;
                    expectedRevision: number;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        rule: {
                            id: string;
                            revision: number;
                            config: {
                                name: string;
                                description?: string;
                                enabled: boolean;
                                trigger: {
                                    when: components["schemas"]["AlertRuleCondition0"];
                                    for: string;
                                };
                                recover: {
                                    description?: string;
                                    name?: string;
                                    when: components["schemas"]["AlertRuleCondition0"];
                                    for: string;
                                };
                                notify: ({
                                    /** @constant */
                                    type: "email";
                                    recipients?: string[];
                                } | {
                                    /** @constant */
                                    type: "slack";
                                    channel?: string;
                                })[];
                            };
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
    deleteApiV1ServersByIdAlertsRulesByRuleId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                ruleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedRevision: number;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        deleted: boolean;
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
    getApiV1OrganizationsByIdMembers: {
        parameters: {
            query?: {
                limit?: number;
                take?: number;
                skip?: number;
                sort?: string;
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
                        items: {
                            id: string;
                            organizationId: string;
                            userId: string;
                            role: string;
                            /** Format: date-time */
                            createdAt: string;
                            user: {
                                id: string;
                                name: string;
                                email: string;
                                image: string | null;
                            };
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
    getApiV1OrganizationsByIdInvitations: {
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
                        invitations: {
                            id: string;
                            organizationId: string;
                            email: string;
                            role: string | null;
                            /** @description `pending`, `accepted`, `rejected` or `canceled`. A pending invitation past `expiresAt` can no longer be accepted. */
                            status: string;
                            inviterId: string;
                            /** Format: date-time */
                            expiresAt: string;
                            /** Format: date-time */
                            createdAt: string;
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
    postApiV1OrganizationsByIdInvitations: {
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
                    /** Format: email */
                    email: string;
                    /**
                     * @description One role: `member`, `admin`, `owner` or a custom role of the organization.
                     * @default member
                     */
                    role?: string;
                    /**
                     * @description When the email already has a pending invitation, extend it and send the email again instead of failing.
                     * @default false
                     */
                    resend?: boolean;
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
                        organizationId: string;
                        email: string;
                        role: string | null;
                        /** @description `pending`, `accepted`, `rejected` or `canceled`. A pending invitation past `expiresAt` can no longer be accepted. */
                        status: string;
                        inviterId: string;
                        /** Format: date-time */
                        expiresAt: string;
                        /** Format: date-time */
                        createdAt: string;
                    };
                };
            };
            /** @description Validation error, or a Better Auth rejection such as `USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`, `USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION` (retry with `resend: true`), `ROLE_NOT_FOUND` or `INVALID_EMAIL`. */
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
            /** @description Not a member, missing `invitation:create`, role not assignable by the caller, `INVITATION_LIMIT_REACHED`, or `PLAN_LIMIT_TEAM_MEMBERS` (body carries the paywall fields of `PlanLimitErrorResponse`). */
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
            /** @description Too many requests */
            429: {
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
    postApiV1OrganizationsByIdInvitationsByInvitationIdCancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                invitationId: string;
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
                        organizationId: string;
                        email: string;
                        role: string | null;
                        /** @description `pending`, `accepted`, `rejected` or `canceled`. A pending invitation past `expiresAt` can no longer be accepted. */
                        status: string;
                        inviterId: string;
                        /** Format: date-time */
                        expiresAt: string;
                        /** Format: date-time */
                        createdAt: string;
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
    getApiV1ServersByIdDomainStatus: {
        parameters: {
            query?: {
                domainId?: string;
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
                        validationMethod?: ("http" | "txt" | "email") | null;
                        validationRecords?: {
                            /** @enum {string} */
                            purpose: "hostname" | "certificate";
                            /** @constant */
                            type: "TXT";
                            name: string;
                            value: string;
                        }[];
                        hostnameReady?: boolean;
                        certificateReady?: boolean;
                        readyToConnect?: boolean;
                        dnsConnected?: boolean | null;
                        domain: string | null;
                        verified: boolean;
                        hostnameId: string | null;
                        status: string | null;
                        sslStatus: string | null;
                        cnameTarget: string | null;
                        configuredAt: string | null;
                        verificationErrors: string[] | null;
                        pendingRemovalAt?: string | null;
                        setupMode?: "new_hostname" | null;
                        gatewayReady?: boolean;
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
    postApiV1ServersByIdDomainRequest: {
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
                    domain: string;
                    /**
                     * @default http
                     * @enum {string}
                     */
                    validationMethod?: "http" | "txt";
                    /**
                     * @default new_hostname
                     * @constant
                     */
                    setupMode?: "new_hostname";
                    branch?: string | null;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        validationMethod?: ("http" | "txt" | "email") | null;
                        validationRecords?: {
                            /** @enum {string} */
                            purpose: "hostname" | "certificate";
                            /** @constant */
                            type: "TXT";
                            name: string;
                            value: string;
                        }[];
                        hostnameReady?: boolean;
                        certificateReady?: boolean;
                        readyToConnect?: boolean;
                        dnsConnected?: boolean | null;
                        success: boolean;
                        domain: string;
                        hostnameId: string;
                        status: string;
                        sslStatus: string;
                        cnameTarget: string;
                        dnsInstructions: string;
                        /** @constant */
                        setupMode?: "new_hostname";
                        gatewayReady?: boolean;
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
                        domain?: string;
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
            /** @description Server not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        domain?: string;
                    };
                };
            };
            /** @description Domain already in use (same hostname on another server you can access, or globally) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        domain?: string;
                    };
                };
            };
        };
    };
    postApiV1ServersByIdDomainVerify: {
        parameters: {
            query?: {
                domainId?: string;
                activate?: "true" | "false";
                validationMethod?: "txt";
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
                        validationMethod?: ("http" | "txt" | "email") | null;
                        validationRecords?: {
                            /** @enum {string} */
                            purpose: "hostname" | "certificate";
                            /** @constant */
                            type: "TXT";
                            name: string;
                            value: string;
                        }[];
                        hostnameReady?: boolean;
                        certificateReady?: boolean;
                        readyToConnect?: boolean;
                        dnsConnected?: boolean | null;
                        success: boolean;
                        verified: boolean;
                        status?: string | null;
                        sslStatus?: string | null;
                        message?: string | null;
                        configuredAt?: string | null;
                        verificationErrors?: string[] | null;
                        gatewayReady?: boolean;
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
            /** @description No domain configured */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        error: string;
                        domain?: string;
                    };
                };
            };
        };
    };
    deleteApiV1ServersByIdDomain: {
        parameters: {
            query?: {
                domainId?: string;
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
                        success: boolean;
                        message: string;
                        pending?: boolean;
                        pendingRemovalAt?: string;
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
    getApiV1GithubConnectUrl: {
        parameters: {
            query: {
                organizationId: string;
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
                        /** Format: uri */
                        url: string;
                        expiresInSeconds: number;
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
