/**
 * Where the cloud CLI keeps its credential, and which credential a command
 * uses.
 *
 * The credential lives in `~/.manufact/auth.json` (mode 0600). Two
 * environment variables override it, in this order:
 *
 * 1. `MANUFACT_TOKEN`
 * 2. `MCP_USE_API_KEY`, still read so existing scripts keep working
 *
 * Earlier CLI versions kept the key in `~/.mcp-use/config.json`. The first
 * read after an upgrade moves it to the new file and deletes the old one.
 */
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { CommandError } from "../../core/errors.js";
import { pathExists, readJson, writePrivateJson } from "../../core/fs.js";

/** What `~/.manufact/auth.json` holds. Every field is optional. */
export interface StoredAuth {
  /** The API key requests are signed with. */
  apiKey?: string;
  /** Cloud id of `apiKey`, when `mcp-use login` created it. Used to revoke it. */
  keyId?: string;
  /** Name of `apiKey` on Cloud, when `mcp-use login` created it. */
  keyName?: string;
  /** Active organization id. */
  orgId?: string;
  /** Active organization name, for display. */
  orgName?: string;
  /** Active organization slug, for display. */
  orgSlug?: string;
}

/** The environment variables that carry a credential, highest priority first. */
const TOKEN_VARIABLES = ["MANUFACT_TOKEN", "MCP_USE_API_KEY"] as const;

/** Where a command's credential came from. */
type CredentialSource =
  | { type: "file"; path: string }
  | { type: "env"; variable: (typeof TOKEN_VARIABLES)[number] };

/** The credential a command signs its requests with. */
interface Credential {
  apiKey: string;
  source: CredentialSource;
}

/** `~/.manufact/auth.json`. */
export function authFilePath(): string {
  return join(homedir(), ".manufact", "auth.json");
}

/** Where earlier CLI versions kept the credential. */
function legacyConfigPath(): string {
  return join(homedir(), ".mcp-use", "config.json");
}

/**
 * Read the stored credential and organization. Moves a credential left by an
 * earlier CLI version into the new file first.
 */
export async function readAuth(): Promise<StoredAuth> {
  const path = authFilePath();
  if (!(await pathExists(path))) await migrateLegacyConfig(path);
  return readJson<StoredAuth>(path, {});
}

/** Replace the stored credential and organization. */
export async function writeAuth(auth: StoredAuth): Promise<void> {
  await writePrivateJson(authFilePath(), auth);
}

/** Merge `changes` into the stored state. */
export async function updateAuth(changes: StoredAuth): Promise<void> {
  await writeAuth({ ...(await readAuth()), ...changes });
}

/** Delete the stored credential, and any left by an earlier CLI version. */
export async function clearAuth(): Promise<void> {
  await rm(authFilePath(), { force: true });
  await rm(legacyConfigPath(), { force: true });
}

/** The credential to use, or `undefined` when there is none. */
async function findCredential(): Promise<Credential | undefined> {
  for (const variable of TOKEN_VARIABLES) {
    const value = process.env[variable];
    if (value !== undefined && value !== "") {
      return { apiKey: value, source: { type: "env", variable } };
    }
  }
  const { apiKey } = await readAuth();
  if (apiKey === undefined || apiKey === "") return undefined;
  return { apiKey, source: { type: "file", path: authFilePath() } };
}

/** The credential to use; throws `not_authenticated` when there is none. */
export async function requireCredential(): Promise<Credential> {
  const credential = await findCredential();
  if (credential === undefined) {
    throw new CommandError(
      "not_authenticated",
      "Not logged in to Manufact Cloud.",
      undefined,
      [LOG_IN]
    );
  }
  return credential;
}

/** The next step for every "not logged in" error. */
export const LOG_IN = {
  description: "Log in to Manufact Cloud",
  command: "mcp-use login",
};

interface LegacyConfig {
  apiKey?: unknown;
  orgId?: unknown;
  orgName?: unknown;
  orgSlug?: unknown;
}

async function migrateLegacyConfig(path: string): Promise<void> {
  const legacyPath = legacyConfigPath();
  if (!(await pathExists(legacyPath))) return;
  const legacy = await readJson<LegacyConfig>(legacyPath, {});
  const auth: StoredAuth = {};
  for (const field of ["apiKey", "orgId", "orgName", "orgSlug"] as const) {
    const value = legacy[field];
    if (typeof value === "string" && value !== "") auth[field] = value;
  }
  await writePrivateJson(path, auth);
  await rm(legacyPath, { force: true });
}
