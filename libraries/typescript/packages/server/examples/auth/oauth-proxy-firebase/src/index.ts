import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { isBuilding, MCPServer } from "mcp-use";
import { firebase, oauthProxy } from "mcp-use/oauth";
import { firestoreStorage } from "mcp-use/oauth/storage";
import { z } from "zod";

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
// A service account key file. Unset, the Admin SDK uses the credentials of
// the runtime, such as the service account on Cloud Run.
const credentials = optionalEnv("MCP_USE_FIREBASE_CREDENTIALS");

// `mcp-use dev` reruns this file after each change. Reuse the app it made.
const app =
  getApps()[0] ??
  initializeApp({
    projectId,
    ...(credentials !== undefined && { credential: cert(credentials) }),
  });
const db = getFirestore(app);

const server = new MCPServer({
  name: "oauth-proxy-firebase-example",
  version: "1.0.0",
  title: "Firebase OAuth proxy example",
  description:
    "Signs users in with Firebase Authentication through the server's own authorization server and keeps their notes in Firestore.",
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
    }),
    // Sign-ins and tokens live in the mcp_use_oauth collection, encrypted
    // with MCP_USE_OAUTH_SECRET.
    storage: firestoreStorage({ firestore: db }),
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
    // The proxy keeps the user's ID token on the server and refreshes it
    // before it expires. upstreamToken(ctx) returns it.
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

/**
 * The signed-in user's notes. The Admin SDK bypasses security rules, so
 * every query starts from the verified uid.
 */
function notesOf(uid: string) {
  return db.collection(`users/${uid}/notes`);
}

server.tool(
  {
    name: "list-notes",
    title: "List notes",
    description: "List the signed-in user's notes, newest first.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ limit }, ctx) => {
    const snapshot = await notesOf(ctx.auth.user.subject)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    const notes = snapshot.docs.map((doc) => {
      const { title, text, createdAt } = doc.data();
      return {
        id: doc.id,
        title,
        text,
        createdAt:
          createdAt instanceof Timestamp
            ? createdAt.toDate().toISOString()
            : null,
      };
    });
    return {
      content: [
        {
          type: "text",
          text:
            notes.length === 0
              ? "No notes yet. Add one with add-note."
              : JSON.stringify(notes, null, 2),
        },
      ],
    };
  }
);

server.tool(
  {
    name: "add-note",
    title: "Add note",
    description: "Add a note for the signed-in user.",
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      text: z.string().max(10_000).default(""),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ title, text }, ctx) => {
    const note = await notesOf(ctx.auth.user.subject).add({
      title,
      text,
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      content: [{ type: "text", text: `Added note ${note.id}.` }],
    };
  }
);

export default server;
