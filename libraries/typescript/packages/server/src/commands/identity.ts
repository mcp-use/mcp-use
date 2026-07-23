import { parseArgs } from "node:util";

import {
  clearCloudConfig,
  cloudAuthUrl,
  CloudApi,
  readCloudConfig,
  resolveOrganization,
  writeCloudConfig,
} from "./cloud-api.js";
import {
  CommandError,
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
  --org <id-or-slug>    Select the active organization
  --no-open             Do not open the verification URL
  --json                Emit machine-readable output
  -h, --help            Show this help`;

/** Run `login`, `logout`, or `whoami`. */
export async function runIdentity(
  command: "login" | "logout" | "whoami",
  argv: readonly string[]
): Promise<number> {
  if (
    command === "login" &&
    argv.some((token) => token === "--help" || token === "-h")
  ) {
    process.stdout.write(`${LOGIN_HELP}\n`);
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
  const selected =
    values.org !== undefined
      ? resolveOrganization(identity.organizations, values.org)
      : identity.organizations.find(
          (organization) => organization.id === identity.defaultOrganizationId
        );
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
    !(await confirm("Delete local cloud credentials?", {
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
