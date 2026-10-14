import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { isBuilding, MCPServer } from "mcp-use";
import { firebase, oauthProxy, upstreamToken } from "mcp-use/oauth";
import { firestoreStorage } from "mcp-use/oauth/storage";
import { z } from "zod";

import { ConsentPage } from "./consent/consent-page.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value !== undefined && value !== "") return value;
  // `mcp-use build` runs this file without serving requests, so a build
  // needs none of these settings.
  if (isBuilding()) return "";
  throw new Error(`${name} must be set`);
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

const allowedClients = optionalEnv("MCP_USE_ALLOWED_CLIENTS")
  ?.split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry !== "");

const projectId = requireEnv("MCP_USE_FIREBASE_PROJECT_ID");
// Local development only. The Auth emulator issues unsigned ID tokens, so
// oauthProxy then refuses to run anywhere but localhost. Keep the server on
// a loopback address, with no tunnel, while it is set.
const authEmulator = optionalEnv("MCP_USE_FIREBASE_AUTH_EMULATOR_URL");
const firestoreEmulator = optionalEnv("MCP_USE_FIRESTORE_EMULATOR_URL");
const firestoreOrigin = (
  firestoreEmulator ?? "https://firestore.googleapis.com"
).replace(/\/+$/, "");

if (firestoreEmulator !== undefined) {
  // The Admin SDK finds the emulator only through this variable, and needs
  // no credentials for it.
  process.env["FIRESTORE_EMULATOR_HOST"] = new URL(firestoreEmulator).host;
}
// A service account key file. Without one, the Admin SDK uses the service
// account of the runtime on Cloud Run or Cloud Functions.
const serviceAccount = optionalEnv("MCP_USE_FIREBASE_SERVICE_ACCOUNT");
// `mcp-use dev` runs this file again after each change, in the same process,
// where the app from the previous run still exists.
const app =
  getApps().length > 0
    ? getApp()
    : initializeApp({
        projectId,
        ...(serviceAccount !== undefined && {
          credential: cert(serviceAccount),
        }),
      });

// Sign-ins, one-time codes, and tokens live in the mcp_use_oauth collection.
// The Admin SDK bypasses security rules. It connects on the first sign-in, so
// a build or a cold start does not wait on Firestore.
const storage = firestoreStorage({ firestore: getFirestore(app) });

const server = new MCPServer({
  name: "oauth-proxy-firebase-example",
  version: "1.0.0",
  title: "Firebase OAuth proxy example",
  description:
    "Signs users in with Firebase Authentication through the server's own authorization server and reads Firestore as them.",
  publicLandingPage: true,
  oauth: oauthProxy({
    upstream: firebase({
      apiKey: requireEnv("MCP_USE_FIREBASE_API_KEY"),
      authDomain: requireEnv("MCP_USE_FIREBASE_AUTH_DOMAIN"),
      projectId,
      // Sign-in providers enabled in the Firebase console. Allow opens the
      // first one in a popup.
      providers: ["google.com"],
      // whoami returns the email address, so only verified ones sign in.
      requireVerifiedEmail: true,
      ...(authEmulator !== undefined && { emulator: { url: authEmulator } }),
    }),
    // The secret comes from MCP_USE_OAUTH_SECRET.
    storage,
    // A custom consent page: src/consent/consent-page.tsx.
    consent: { page: ConsentPage },
    ...(allowedClients !== undefined && { clients: allowedClients }),
  }),
});

/** Reads a string field of the Firebase profile that the proxy keeps. */
function profileString(
  profile: Record<string, unknown>,
  field: string
): string | null {
  const value = profile[field];
  return typeof value === "string" ? value : null;
}

const whoamiOutputSchema = z.object({
  uid: z.string(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  provider: z.string().nullable(),
  mcpClient: z.string().nullable(),
  idTokenExpiresAt: z.string().nullable(),
});

server.tool(
  {
    name: "whoami",
    title: "Who am I",
    description:
      "Return the signed-in Firebase user and the MCP client that connected.",
    outputSchema: whoamiOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_args, ctx) => {
    // The subject is the Firebase uid. The profile holds the claims of the
    // ID token the user signed in with.
    const { subject, profile } = ctx.auth.user;
    // The proxy refreshes the ID token on the server before it expires.
    const expiresAt = ctx.auth.upstream?.expiresAt;
    const data = {
      uid: subject,
      email: profileString(profile, "email"),
      emailVerified: profile["email_verified"] === true,
      name: profileString(profile, "name"),
      provider: profileString(profile, "sign_in_provider"),
      mcpClient: ctx.auth.clientId ?? null,
      idTokenExpiresAt:
        expiresAt === undefined
          ? null
          : new Date(expiresAt * 1000).toISOString(),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
);

/** A Firestore REST value, reduced to plain JSON. */
function firestoreValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const [type, inner] = Object.entries(value)[0] ?? [];
  switch (type) {
    case "stringValue":
    case "booleanValue":
    case "doubleValue":
    case "timestampValue":
    case "referenceValue":
      return inner;
    case "integerValue":
      return Number(inner);
    case "nullValue":
      return null;
    default:
      return value;
  }
}

/** Why Firestore refused the request, in words that say what to change. */
function firestoreError(status: number, message: string, uid: string): string {
  const path = `users/${uid}/notes`;
  switch (status) {
    case 401:
      return `Firestore did not accept the user's Firebase ID token: ${message}`;
    case 403:
      // A rules denial says "Missing or insufficient permissions."; a
      // disabled Firestore API is a 403 too, with another message.
      return /insufficient permissions/i.test(message)
        ? `The Firestore security rules do not let this user read ${path}. Deploy firestore.rules from this example. Firestore said: ${message}`
        : `Firestore refused the request: ${message}`;
    case 404:
      return `Project ${projectId} has no default Firestore database. Create one in the Firebase console (Firestore Database > Create database). Firestore said: ${message}`;
    default:
      return `Firestore answered HTTP ${status}: ${message}`;
  }
}

server.tool(
  {
    name: "list-notes",
    title: "List notes",
    description:
      "List the signed-in user's notes from Firestore (users/{uid}/notes). Firestore checks its security rules as that user.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ limit }, ctx) => {
    const uid = ctx.auth.user.subject;
    const url = new URL(
      `${firestoreOrigin}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}/notes`
    );
    url.searchParams.set("pageSize", String(limit));
    // upstreamToken(ctx) is the user's Firebase ID token, which the proxy
    // keeps on the server and refreshes. Sent as a bearer token, it makes
    // Firestore apply its security rules to this user.
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${upstreamToken(ctx)}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      documents?: Array<{
        name: string;
        fields?: Record<string, unknown>;
        updateTime?: string;
      }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      return {
        content: [
          {
            type: "text",
            text: firestoreError(
              response.status,
              body.error?.message ?? response.statusText,
              uid
            ),
          },
        ],
        isError: true,
      };
    }
    // An empty or missing collection is a 200 with no documents.
    const notes = (body.documents ?? []).map((document) => ({
      id: document.name.slice(document.name.lastIndexOf("/") + 1),
      ...Object.fromEntries(
        Object.entries(document.fields ?? {}).map(([field, value]) => [
          field,
          firestoreValue(value),
        ])
      ),
      ...(document.updateTime !== undefined && {
        updated: document.updateTime,
      }),
    }));
    return {
      content: [
        {
          type: "text",
          text:
            notes.length === 0
              ? `No notes. Add documents to users/${uid}/notes in Firestore.`
              : JSON.stringify(notes, null, 2),
        },
      ],
    };
  }
);

export default server;
