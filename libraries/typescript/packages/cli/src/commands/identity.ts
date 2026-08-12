import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";

import {
  clearCloudConfig,
  cloudAuthUrl,
  CloudApi,
  type CloudOrganization,
  readCloudConfig,
  resolveOrganization,
  writeCloudConfig,
} from "./cloud-api.js";
import {
  CommandError,
  CommandUsageError,
  confirm,
  openBrowser,
  printResult,
  reportError,
  UsageError,
  wantsJson,
} from "./shared.js";

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface DeviceToken {
  access_token?: string;
  error?: string;
  error_description?: string;
}

const DEVICE_CLIENT_ID = "mcp-use-cli";
const DEVICE_POLL_TIMEOUT = 30 * 60 * 1000;

const LOGIN_HELP = `Usage: mcp-use login [options]

Authenticate the cloud CLI.

Options:
  --api-key <key>       Authenticate with an API key
  --device-code <code>  Redeem a pre-approved device code
  --org <id-or-slug>    Select the active organization (required for headless
                        login when the account has no default)
  --no-open             Do not open the verification URL
  --json                Emit machine-readable output
  -h, --help            Show this help`;

const LOGOUT_HELP = `Usage: mcp-use logout [options]

Log out of the cloud CLI and delete local cloud credentials.

Options:
  --yes       Confirm without prompting
  --json      Emit {"loggedOut":true}; never prompt
  -h, --help  Show this help

Exit codes:
  0  Logged out, cancelled interactively, or help
  2  Confirmation is required in a non-interactive run
  1  Local credential removal failed`;

const WHOAMI_HELP = `Usage: mcp-use whoami [options]

Show the authenticated cloud identity and active organization.

Options:
  --json      Emit a machine-readable identity object
  -h, --help  Show this help

Exit codes:
  0  Success or help
  1  Authentication or API failure`;

/** Run `login`, `logout`, or `whoami`. */
export async function runIdentity(
  command: "login" | "logout" | "whoami",
  argv: readonly string[]
): Promise<number> {
  if (argv.some((token) => token === "--help" || token === "-h")) {
    process.stdout.write(
      `${command === "login" ? LOGIN_HELP : command === "logout" ? LOGOUT_HELP : WHOAMI_HELP}\n`
    );
    return 0;
  }
  const json = wantsJson(argv);
  try {
    if (command === "login") return await login(argv, json);
    if (command === "logout") return await logout(argv, json);
    return await whoami(argv, json);
  } catch (error) {
    return reportError(
      error instanceof TypeError ? new UsageError(error.message) : error,
      json
    );
  }
}

async function login(argv: readonly string[], json: boolean): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      "api-key": { type: "string" },
      "device-code": { type: "string" },
      org: { type: "string" },
      "no-open": { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  if (values["api-key"] !== undefined && values["device-code"] !== undefined) {
    throw new UsageError(
      "--api-key and --device-code cannot be used together."
    );
  }
  const deviceCode = values["device-code"]?.trim();
  if (values["device-code"] !== undefined && deviceCode === "") {
    throw new UsageError("--device-code must not be empty.");
  }
  // An explicit device code is an intentional re-login and takes precedence
  // over MCP_USE_API_KEY. An explicit API key remains mutually exclusive so a
  // typo cannot silently authenticate as a different account.
  let apiKey =
    deviceCode === undefined
      ? (values["api-key"] ?? process.env["MCP_USE_API_KEY"])
      : undefined;
  if (apiKey === undefined) {
    apiKey =
      deviceCode === undefined
        ? await deviceLogin(values["no-open"] === true || !process.stdout.isTTY)
        : await redeemProvidedDeviceCode(deviceCode);
  }
  const identity = await CloudApi.withApiKey(apiKey).identity();
  let selected =
    values.org !== undefined
      ? resolveOrganization(identity.organizations, values.org)
      : identity.organizations.find(
          (organization) => organization.id === identity.defaultOrganizationId
        );
  selected ??=
    identity.organizations.length === 1 ? identity.organizations[0] : undefined;
  if (selected === undefined) {
    await writeCloudConfig({ apiKey });
    if (identity.organizations.length === 0) {
      throw new CommandError(
        "organization_required",
        "The account does not belong to an organization.",
        {
          nextSteps: [
            {
              description: "Create or join an organization, then log in again",
              command: "mcp-use login",
            },
          ],
        }
      );
    }
    if (json || !process.stdin.isTTY) {
      throw organizationSelectionRequired(identity.organizations);
    }
    selected = await promptOrganization(identity.organizations);
  }
  await writeCloudConfig({
    apiKey,
    ...(selected !== undefined
      ? {
          orgId: selected.id,
          orgName: selected.name,
          ...(selected.slug !== null ? { orgSlug: selected.slug } : {}),
        }
      : {}),
  });
  printResult(
    { email: identity.email, organization: selected ?? null },
    json,
    `Logged in as ${identity.email}${
      selected !== undefined ? ` (${selected.name})` : ""
    }.`
  );
  return 0;
}

function organizationSelectionRequired(
  organizations: CloudOrganization[]
): CommandUsageError {
  return new CommandUsageError(
    "organization_required",
    "Choose an active organization for this login.",
    {
      organizations: organizations.map(({ id, name, slug }) => ({
        id,
        name,
        slug,
      })),
      nextSteps: [
        {
          description: "Select an organization with this saved login",
          command: "mcp-use org use <id-or-slug>",
        },
        {
          description: "Select it during a future headless login",
          command: "mcp-use login --org <id-or-slug>",
        },
      ],
    }
  );
}

async function promptOrganization(
  organizations: CloudOrganization[]
): Promise<CloudOrganization> {
  process.stdout.write("Choose an active organization:\n");
  organizations.forEach((organization, index) => {
    const selector =
      organization.slug === null ? organization.id : organization.slug;
    process.stdout.write(
      `  ${index + 1}. ${organization.name} (${selector})\n`
    );
  });
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question("Organization [1]: ");
    const index = answer.trim() === "" ? 0 : Number(answer) - 1;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= organizations.length
    ) {
      throw new UsageError("Invalid organization selection.");
    }
    return organizations[index]!;
  } finally {
    prompt.close();
  }
}

async function logout(argv: readonly string[], json: boolean): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      yes: { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  if (
    !(await confirm("Log out?", {
      yes: values.yes === true,
      json,
    }))
  ) {
    return 0;
  }
  await clearCloudConfig();
  printResult({ loggedOut: true }, json, "Logged out.");
  return 0;
}

async function whoami(argv: readonly string[], json: boolean): Promise<number> {
  parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: { json: { type: "boolean" } },
  });
  const config = await readCloudConfig();
  const identity = await (await CloudApi.create()).identity();
  const organization =
    identity.organizations.find((item) => item.id === config.orgId) ?? null;
  const result = {
    userId: identity.userId,
    email: identity.email,
    organization,
  };
  printResult(
    result,
    json,
    `${identity.email}${organization !== null ? ` — ${organization.name}` : ""}`
  );
  return 0;
}

async function deviceLogin(noOpen: boolean): Promise<string> {
  const base = cloudAuthUrl();
  const codeResponse = await fetch(`${base}/api/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: DEVICE_CLIENT_ID,
      scope: "openid profile email",
    }),
  });
  if (!codeResponse.ok) {
    throw new CommandError(
      "login_failed",
      `Could not start device login (${codeResponse.status}).`
    );
  }
  const code = (await codeResponse.json()) as DeviceCode;
  const verificationUrl =
    code.verification_uri_complete ?? code.verification_uri;
  process.stderr.write(
    `Open ${verificationUrl} and enter code ${code.user_code}.\n`
  );
  if (!noOpen) openBrowser(verificationUrl);

  return pollForDeviceToken(
    base,
    code.device_code,
    Math.max(code.interval, 1),
    Date.now() + code.expires_in * 1000
  );
}

/** Redeem a device code already approved by the authenticated web onboarding flow. */
async function redeemProvidedDeviceCode(deviceCode: string): Promise<string> {
  return pollForDeviceToken(
    cloudAuthUrl(),
    deviceCode,
    2,
    Date.now() + DEVICE_POLL_TIMEOUT
  );
}

async function pollForDeviceToken(
  base: string,
  deviceCode: string,
  initialInterval: number,
  deadline: number
): Promise<string> {
  let interval = initialInterval;
  let firstAttempt = true;
  while (Date.now() < deadline) {
    if (!firstAttempt) await sleep(interval * 1000);
    firstAttempt = false;
    const response = await fetch(`${base}/api/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: DEVICE_CLIENT_ID,
      }),
    });
    const token = (await response.json()) as DeviceToken;
    if (token.access_token !== undefined) {
      const apiKeyResponse = await fetch(`${base}/api/auth/api-key/create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "CLI", prefix: "mcp_" }),
      });
      if (!apiKeyResponse.ok) {
        throw new CommandError(
          "login_failed",
          "Could not create a CLI API key."
        );
      }
      const apiKey = (await apiKeyResponse.json()) as { key?: unknown };
      if (typeof apiKey.key !== "string") {
        throw new CommandError(
          "login_failed",
          "Cloud returned an invalid API key."
        );
      }
      return apiKey.key;
    }
    if (token.error === "authorization_pending") continue;
    if (token.error === "slow_down") {
      interval += 5;
      continue;
    }
    throw deviceTokenError(token);
  }
  throw new CommandError("login_timeout", "Device login expired.");
}

function deviceTokenError(token: DeviceToken): CommandError {
  if (token.error === "access_denied") {
    return new CommandError("login_failed", "Device login was denied.");
  }
  if (token.error === "expired_token") {
    return new CommandError("login_failed", "Device code has expired.");
  }
  // Device codes are bearer credentials. Do not include an untrusted server
  // diagnostic here: an intermediary may reflect the submitted code.
  return new CommandError(
    "login_failed",
    "Device code is invalid, expired, or has already been redeemed."
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
