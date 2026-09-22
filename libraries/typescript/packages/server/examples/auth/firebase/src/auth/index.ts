import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import {
  createNativeMcpAuth,
  type NativeMcpAuthOptions,
  type NativeOAuthUser,
} from "mcp-use/oauth/better-auth-mcp";
import { firebaseIdentityAdapter } from "./firebase.js";
import type { FirebaseWebConfig } from "./identity.js";
import { renderFirebaseConsent, renderFirebaseLogin } from "./pages.js";

/** Native identity mapped by the shared SDK bridge. */
export type FirebaseOAuthUser = NativeOAuthUser;

/** Application configuration for the Firebase example's shared OAuth engine. */
export interface FirebaseAuthOptions extends Pick<
  NativeMcpAuthOptions,
  "requiredScopes"
> {
  /** Canonical public MCP endpoint. */
  resource: URL | string;
  /** Existing public Firebase web configuration. */
  firebase: FirebaseWebConfig;
  /** Application-owned SQL connection supported by the shared engine factory. */
  database: NativeMcpAuthOptions["database"];
  /** Stable engine secret used to protect sessions and native bindings. */
  secret: string;
  /** Shared serialization for PostgreSQL; omit to use the SDK's local guard. */
  runTokenOperation?: NativeMcpAuthOptions["runTokenOperation"];
}

/** Configures an engine; schema migration and listening remain explicit. */
export async function createFirebaseAuth(options: FirebaseAuthOptions) {
  const resource = new URL(options.resource);
  const origin = resource.origin;
  const engine = await createNativeMcpAuth({
    resource,
    database: options.database,
    secret: options.secret,
    providers: { firebase: firebaseIdentityAdapter(options.firebase) },
    sessionPolicy: "strict",
    scopes: ["openid", "profile", "email", "offline_access", "mcp:read"],
    requiredScopes: options.requiredScopes ?? ["mcp:read"],
    allowDynamicClientRegistration: true,
    fetchClientMetadataResource,
    ipAddressHeaders: ["x-mcp-peer-ip"],
    runTokenOperation: options.runTokenOperation,
  });
  return {
    async getMigrations() {
      const schema = await engine.getMigrations();
      if (schema.schemaProblems.length) {
        // Both startup and the migrate command must report problems that the
        // automatic migration cannot fix instead of suggesting another retry.
        console.error(
          "Firebase authentication schema requires manual repair; pnpm migrate cannot fix these problems:",
          schema.schemaProblems
        );
        throw new Error("Authentication schema requires manual repair");
      }
      return schema;
    },
    async connect() {
      const integration = await engine.connect();
      return {
        requestAuth: integration.requestAuth,
        async handleRequest(request: Request): Promise<Response | undefined> {
          const url = new URL(request.url);
          if (
            url.pathname === engine.loginPath ||
            url.pathname === engine.consentPath
          ) {
            if (url.origin !== origin || request.method !== "GET")
              return new Response(null, { status: 403 });
            if (url.search.length > 16_384)
              return new Response(null, { status: 414 });
            const page = {
              origin,
              basePath: engine.basePath,
              oauthQuery: url.search.slice(1),
            };
            return url.pathname === engine.loginPath
              ? renderFirebaseLogin({ ...page, config: options.firebase })
              : renderFirebaseConsent(page);
          }
          return integration.handle(request);
        },
      };
    },
  };
}
