/**
 * `mcp-use login`: sign in and store an API key for the cloud commands.
 *
 * - In a terminal it shows a device code, opens the browser and waits for the
 *   user to approve it.
 * - Without a TTY, or with `--json`, it prints the device code as JSON and
 *   exits at once; `login --device-code <code>` finishes the login after the
 *   user approves it. Agents can't answer a prompt, so they never wait here.
 * - `--api-key <key>` signs in with a key the user already has.
 *
 * A device login creates a new API key named `CLI · <hostname>`, so the user
 * can tell which machine it belongs to, and `logout` can revoke it.
 */
import { hostname } from "node:os";

import { callerFor, createCloudClient } from "../api/client.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { UsageError, type NextStep } from "../../core/errors.js";
import { openBrowser } from "../../core/open-browser.js";
import {
  chooseOrganization,
  findOrganization,
  listOrganizations,
  sessionEmail,
  type CloudOrganization,
} from "./account.js";
import { requestDeviceCode, waitForApproval } from "./device.js";
import { authFilePath, readAuth, writeAuth, type StoredAuth } from "./store.js";

const USAGE =
  "mcp-use login [--api-key <key> | --device-code <code>] [--org <id-or-slug>] [--no-open] [--json]";

const HELP = `Usage: ${USAGE}

Log in to Manufact Cloud and store an API key in ~/.manufact/auth.json.

In a terminal, login shows a code, opens the browser and waits for you to
approve it. Without a terminal, or with --json, it prints the code as JSON and
exits; run the printed \`mcp-use login --device-code <code>\` once the code is
approved to finish.

Options:
  --api-key <key>       Log in with an existing API key
  --device-code <code>  Finish a login started without a terminal
  --org <id-or-slug>    Choose the active organization
  --no-open             Don't open the browser
  --json                Emit one JSON document
  -h, --help            Show this help

Environment:
  MANUFACT_TOKEN        API key to use instead of the stored one
  MCP_USE_API_KEY       Same, read when MANUFACT_TOKEN is unset

Exit codes:
  0  Logged in, or the device code was printed
  1  The login failed
  2  Invalid arguments`;

/** A new or existing API key, and what Cloud knows it as. */
interface ApiKey {
  apiKey: string;
  /** Set when this login created the key. */
  keyId?: string;
  keyName?: string;
}

/** Run `mcp-use login`. */
export async function runLogin(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, async (output) => {
    const { values } = parseCommandArgs(argv, {
      options: {
        "api-key": { type: "string" },
        "device-code": { type: "string" },
        org: { type: "string" },
        "no-open": { type: "boolean" },
        json: { type: "boolean" },
      },
      positionals: 0,
      usage: USAGE,
    });
    const apiKeyFlag = nonEmpty(values["api-key"], "--api-key");
    const deviceCode = nonEmpty(values["device-code"], "--device-code");
    const org = nonEmpty(values.org, "--org");
    if (apiKeyFlag !== undefined && deviceCode !== undefined) {
      throw new UsageError(
        "Pass --api-key or --device-code, not both.\nUsage: " + USAGE
      );
    }

    // Read before a new key overwrites the file, to keep the organization.
    const previous = await readAuth();
    let key: ApiKey;
    if (apiKeyFlag !== undefined) {
      key = { apiKey: apiKeyFlag };
    } else if (deviceCode !== undefined) {
      key = await createApiKey(await waitForApproval(deviceCode));
    } else {
      const code = await requestDeviceCode();
      if (output.json || process.stdout.isTTY !== true) {
        // Without a terminal nobody is watching this process, so hand the
        // code to the caller instead of waiting for it.
        const pending = {
          user_code: code.user_code,
          verification_uri: code.verification_uri,
          ...(code.verification_uri_complete !== undefined
            ? { verification_uri_complete: code.verification_uri_complete }
            : {}),
          device_code: code.device_code,
          expires_in: code.expires_in,
          interval: code.interval,
          nextSteps: [
            {
              description: "Finish the login once the code is approved",
              command:
                `mcp-use login --device-code ${code.device_code}` +
                (org !== undefined ? ` --org ${org}` : ""),
            },
          ],
        };
        output.result(pending, JSON.stringify(pending, null, 2));
        return;
      }
      const url = code.verification_uri_complete ?? code.verification_uri;
      process.stderr.write(
        `Open ${url} and enter the code ${code.user_code}.\nWaiting for approval...\n`
      );
      if (values["no-open"] !== true) openBrowser(url);
      key = await createApiKey(
        await waitForApproval(code.device_code, {
          intervalSeconds: code.interval,
          expiresInSeconds: code.expires_in,
        })
      );
    }

    const result = await finishLogin(key, org, previous);
    output.result(result, humanSummary(result));
  });
}

/** Create the CLI's own API key with a short-lived login token. */
async function createApiKey(token: string): Promise<ApiKey> {
  const name = `CLI · ${hostname()}`;
  const created = await callerFor(token)(
    createCloudClient({ bearer: token }).POST("/api/auth/api-key/create", {
      body: { name, prefix: "mcp_" },
    })
  );
  const key = {
    apiKey: created.key,
    keyId: created.id,
    keyName: created.name ?? name,
  };
  // Store the key before anything else can fail, so `logout` can still
  // revoke it.
  await writeAuth(key);
  return key;
}

interface LoginResult {
  email: string;
  organization: CloudOrganization | null;
  keyName: string | null;
  credentialPath: string;
  nextSteps: NextStep[];
}

/** Look up who `key` belongs to, choose the organization, and store both. */
async function finishLogin(
  key: ApiKey,
  org: string | undefined,
  previous: StoredAuth
): Promise<LoginResult> {
  const api = {
    client: createCloudClient({ apiKey: key.apiKey }),
    call: callerFor(key.apiKey),
  };
  const [email, organizations] = await Promise.all([
    sessionEmail(api),
    listOrganizations(api),
  ]);
  // Keep the organization chosen before when it belongs to this account too.
  const storedId = organizations.some((item) => item.id === previous.orgId)
    ? previous.orgId
    : undefined;
  const organization =
    org !== undefined
      ? findOrganization(organizations, org)
      : await chooseOrganization(api, organizations, { storedId });
  await writeAuth({
    apiKey: key.apiKey,
    ...(key.keyId !== undefined ? { keyId: key.keyId } : {}),
    ...(key.keyName !== undefined ? { keyName: key.keyName } : {}),
    ...(organization !== undefined
      ? {
          orgId: organization.id,
          orgName: organization.name,
          ...(organization.slug !== null ? { orgSlug: organization.slug } : {}),
        }
      : {}),
  });
  return {
    email,
    organization: organization ?? null,
    keyName: key.keyName ?? null,
    credentialPath: authFilePath(),
    nextSteps:
      organization === undefined
        ? [
            {
              description: "Choose the active organization",
              command: "mcp-use org use <id-or-slug>",
            },
          ]
        : [],
  };
}

function humanSummary(result: LoginResult): string {
  const lines = [
    `Logged in as ${result.email}${
      result.organization !== null ? ` (${result.organization.name})` : ""
    }.`,
  ];
  for (const step of result.nextSteps) {
    lines.push(`${step.description}: ${step.command}`);
  }
  return lines.join("\n");
}

function nonEmpty(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") throw new UsageError(`${flag} must not be empty.`);
  return trimmed;
}
