import {
  buildOAuthProtectedResourceMetadata,
  type AuthInfo,
  type CallToolResult,
  type JsonSchemaType,
  type OAuthMetadata,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

import { normalizedStrings, numberValue, requiredString } from "../jwt.js";
import type { OAuthProviderHost } from "../provider.js";
import { liveLaneConnection } from "./connections.js";
import {
  decorateLaneInstructions,
  laneAuthGuideText,
  laneInsufficientScopeMessage,
  laneSessionInfoDescription,
  laneStepUpRequiredMessage,
  laneStepUpToolDescription,
  sanitizeLaneTask,
} from "./text.js";
import {
  LANE_AUTH_GUIDE_NAME,
  LANE_AUTH_GUIDE_URI,
  LANE_PERSONALIZATION_SCOPE,
  LANE_SESSION_INFO_TOOL,
  LANE_STEP_UP_TOOL,
  LANE_TASK_MAX_CHARS,
  type LaneConnectionRecord,
  type LaneConnectionStore,
  type LaneEnforcement,
  type LaneGateEvent,
  type LaneTokenExchanger,
} from "./types.js";

/**
 * Resolved configuration handed to the setup hook.
 *
 * @internal
 */
export interface LaneSetupConfig {
  issuer: string;
  connections: LaneConnectionStore;
  exchanger: LaneTokenExchanger;
  oauthMetadata: OAuthMetadata;
  scopesSupported: string[];
  resourceName?: string;
  serviceDocumentationUrl?: URL;
  toolScopes: Record<string, string | readonly string[]>;
  enforcement: LaneEnforcement;
  onGateEvent?: (event: LaneGateEvent) => void;
  sessionInfoTool: boolean;
  authGuide: boolean;
}

const RESERVED_TOOLS: ReadonlySet<string> = new Set([
  LANE_STEP_UP_TOOL,
  LANE_SESSION_INFO_TOOL,
]);

/** Verified caller facts the gate and reserved tools work from. */
interface LaneClaims {
  sub: string;
  jti: string;
  agentId: string;
  issuer: string;
  authTime: number | undefined;
}

/**
 * Builds the provider `setup` hook that installs Lane's gate and surface.
 *
 * @internal
 */
export function createLaneSetup(
  config: LaneSetupConfig
): (host: OAuthProviderHost) => void {
  return (host) => {
    const resource = host.resource.href;
    const rootMetadataPath = "/.well-known/oauth-protected-resource";
    const metadataUrl = `${host.resource.origin}${rootMetadataPath}`;

    host.use("mcp:tools/call", async (ctx, next) => {
      const tool = ctx.params.name;
      if (RESERVED_TOOLS.has(tool)) return next();

      const claims = claimsFromAuthInfo(ctx.auth);
      if (claims === undefined) {
        return errorResult("unauthorized: no verified caller on this request");
      }

      const connection = await liveLaneConnection(config.connections, {
        sub: claims.sub,
        jti: claims.jti,
      });
      const scopes = connection?.scopes ?? [];

      if (connection === null) {
        if (config.enforcement === "gate-all") {
          emit(config, { decision: "blocked", tool, claims, scopes });
          return errorResult(laneStepUpRequiredMessage());
        }
        emit(config, { decision: "would-have-blocked", tool, claims, scopes });
        return next();
      }

      for (const scope of normalizedStrings(config.toolScopes[tool])) {
        if (!connection.scopes.includes(scope)) {
          emit(config, { decision: "blocked", tool, claims, scopes });
          return errorResult(laneInsufficientScopeMessage(scope));
        }
      }

      emit(config, { decision: "allowed", tool, claims, scopes });
      return next();
    });

    host.registerTool(
      {
        name: LANE_STEP_UP_TOOL,
        description: laneStepUpToolDescription(),
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            task: {
              type: "string",
              description:
                "One line on what you are trying to accomplish, in the user's terms. Optional.",
              maxLength: LANE_TASK_MAX_CHARS,
            },
          },
          required: [],
          additionalProperties: false,
        }),
      },
      async (params, ctx) => {
        const claims = claimsFromPayload(ctx.auth.payload);
        if (claims === undefined) {
          return errorResult(
            "unauthorized: no verified caller on this request"
          );
        }

        let granted;
        try {
          granted = await config.exchanger.exchange({
            subjectToken: ctx.auth.accessToken,
            resource,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "token exchange failed";
          return errorResult(`step-up failed: ${message}`);
        }

        // Consent is mechanical and reads from what was just granted: without
        // the personalization scope the connection is still recorded, but the
        // model-authored task text is not.
        const personalized = granted.scopes.includes(
          LANE_PERSONALIZATION_SCOPE
        );
        const rawTask = params["task"];
        const task =
          personalized && typeof rawTask === "string"
            ? sanitizeLaneTask(rawTask, LANE_TASK_MAX_CHARS)
            : undefined;

        await config.connections.put(
          { sub: claims.sub, jti: claims.jti },
          {
            scopes: granted.scopes,
            accessToken: granted.accessToken,
            ...(granted.expiresIn !== undefined && {
              expiresAt: Math.floor(Date.now() / 1000) + granted.expiresIn,
            }),
            ...(task !== undefined && task.length > 0 && { task }),
          }
        );

        return textResult({ ok: true, personalized, scopes: granted.scopes });
      }
    );

    if (config.sessionInfoTool) {
      host.registerTool(
        {
          name: LANE_SESSION_INFO_TOOL,
          description: laneSessionInfoDescription(),
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              probe_scope: {
                type: "string",
                description:
                  "Optional. Report whether this connection carries a named scope.",
                maxLength: 64,
              },
            },
            required: [],
            additionalProperties: false,
          }),
        },
        async (params, ctx) => {
          const claims = claimsFromPayload(ctx.auth.payload);
          if (claims === undefined) {
            return errorResult(
              "unauthorized: no verified caller on this request"
            );
          }
          const connection = await liveLaneConnection(config.connections, {
            sub: claims.sub,
            jti: claims.jti,
          });
          const probe = params["probe_scope"];
          return textResult(
            sessionReport(
              claims,
              connection,
              typeof probe === "string" && probe.length > 0 ? probe : undefined
            )
          );
        }
      );
    }

    if (config.authGuide) {
      const text = laneAuthGuideText({
        sessionInfo: config.sessionInfoTool,
        metadataUrl,
      });
      host.registerResource(
        {
          name: LANE_AUTH_GUIDE_NAME,
          uri: LANE_AUTH_GUIDE_URI,
          title: "How to register a session",
          description:
            "What to call before using this server's tools, and what carries across Lane servers.",
          mimeType: "text/markdown",
        },
        async (uri) => ({
          contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
        })
      );
    }

    // Lane's prober reads the root-form document; the SDK only serves the
    // path-inserted form when the resource has a path.
    if (host.resource.pathname !== "/" && host.resource.pathname !== "") {
      const document = buildOAuthProtectedResourceMetadata({
        oauthMetadata: config.oauthMetadata,
        resourceServerUrl: host.resource,
        scopesSupported: config.scopesSupported,
        ...(config.resourceName !== undefined && {
          resourceName: config.resourceName,
        }),
        ...(config.serviceDocumentationUrl !== undefined && {
          serviceDocumentationUrl: config.serviceDocumentationUrl,
        }),
      });
      const body = JSON.stringify(document);
      host.route(
        rootMetadataPath,
        () =>
          new Response(body, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*",
              "cache-control": "no-store",
            },
          })
      );
    }

    host.instructions(decorateLaneInstructions);
  };
}

function claimsFromAuthInfo(authInfo: AuthInfo | undefined) {
  const payload = authInfo?.extra?.["payload"];
  if (payload === null || typeof payload !== "object") return undefined;
  return claimsFromPayload(payload as Record<string, unknown>);
}

function claimsFromPayload(
  payload: Record<string, unknown>
): LaneClaims | undefined {
  const sub = requiredString(payload, "sub");
  const jti = requiredString(payload, "jti");
  if (sub === undefined || jti === undefined) return undefined;
  return {
    sub,
    jti,
    agentId: requiredString(payload, "client_id") ?? "",
    issuer: requiredString(payload, "iss") ?? "",
    authTime: numberValue(payload, "auth_time"),
  };
}

function emit(
  config: LaneSetupConfig,
  input: {
    decision: LaneGateEvent["decision"];
    tool: string;
    claims: LaneClaims;
    scopes: string[];
  }
): void {
  if (config.onGateEvent === undefined) return;
  try {
    config.onGateEvent({
      decision: input.decision,
      tool: input.tool,
      agentId: input.claims.agentId,
      sub: input.claims.sub,
      scopes: [...input.scopes],
    });
  } catch {
    // Observability must never break a tool call.
  }
}

function sessionReport(
  claims: LaneClaims,
  connection: LaneConnectionRecord | null,
  probeScope: string | undefined
) {
  const report: Record<string, unknown> = {
    connected: connection !== null,
    next_step:
      connection === null
        ? `No session yet. Call \`${LANE_STEP_UP_TOOL}\` first; every other tool on ` +
          "this server is refused until you do."
        : "Session established. Every tool on this server is callable.",
    identity: {
      customer_id: claims.sub,
      agent_id: claims.agentId,
      credential_id: claims.jti,
      issuer: claims.issuer,
      human_authenticated_at: isoFromSeconds(claims.authTime),
    },
    session:
      connection === null
        ? null
        : {
            scopes: connection.scopes,
            task: connection.task ?? null,
            task_recorded: connection.task !== undefined,
            connected_at: new Date(connection.createdAt).toISOString(),
            expires_at: isoFromSeconds(connection.expiresAt),
          },
  };
  if (probeScope !== undefined) {
    report["scope_probe"] = {
      scope: probeScope,
      granted: connection?.scopes.includes(probeScope) ?? false,
    };
  }
  return report;
}

function isoFromSeconds(seconds: number | undefined): string | null {
  return seconds === undefined ? null : new Date(seconds * 1000).toISOString();
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Wraps raw JSON Schema as a Standard Schema; the SDK validates input. */
function jsonSchema(
  schema: Record<string, unknown>
): StandardSchemaWithJSON<Record<string, unknown>, Record<string, unknown>> {
  return {
    "~standard": {
      version: 1,
      vendor: "mcp-use-lane",
      validate(value) {
        return { value: value as Record<string, unknown> };
      },
      jsonSchema: {
        input: () => schema as JsonSchemaType,
        output: () => schema as JsonSchemaType,
      },
    },
  };
}
