/**
 * The OAuth device authorization flow (RFC 8628) that `mcp-use login` signs
 * in with. Cloud's OpenAPI document leaves out the two device endpoints, so
 * these requests are written by hand rather than generated.
 */
import { cloudAuthUrl } from "../cloud-api.js";
import { CommandError } from "../../core/errors.js";

/** What `POST /api/auth/device/code` returns. */
interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  /** Seconds until `device_code` expires. */
  expires_in: number;
  /** Seconds to wait between polls. */
  interval: number;
}

interface DeviceTokenResponse {
  access_token?: unknown;
  error?: unknown;
}

const CLIENT_ID = "mcp-use-cli";

/** RFC 8628's default poll interval, used for `login --device-code`. */
const DEFAULT_INTERVAL_SECONDS = 5;

/** Give up on a code Cloud keeps reporting as pending after this long. */
const MAX_WAIT_MS = 30 * 60 * 1000;

/**
 * Overrides every poll interval, in milliseconds. Tests set it so polling
 * doesn't sleep; it isn't meant for everyday use.
 */
const POLL_INTERVAL_VARIABLE = "MCP_USE_POLL_INTERVAL_MS";

/** Ask Cloud for a new device code. */
export async function requestDeviceCode(): Promise<DeviceCode> {
  const response = await post("/api/auth/device/code", {
    client_id: CLIENT_ID,
    scope: "openid profile email",
  });
  if (!response.ok) {
    throw new CommandError(
      "login_failed",
      `Could not start the device login (${response.status}).`
    );
  }
  const code = (await response.json()) as Partial<DeviceCode>;
  if (
    typeof code.device_code !== "string" ||
    typeof code.user_code !== "string" ||
    typeof code.verification_uri !== "string" ||
    typeof code.expires_in !== "number" ||
    typeof code.interval !== "number"
  ) {
    throw new CommandError(
      "login_failed",
      "Manufact Cloud returned an invalid device code."
    );
  }
  return code as DeviceCode;
}

/**
 * Poll until the user approves `deviceCode`, and return the short-lived
 * access token Cloud then issues. Throws `login_denied`,
 * `device_code_expired` or `device_code_invalid` otherwise.
 */
export async function waitForApproval(
  deviceCode: string,
  options: { intervalSeconds?: number; expiresInSeconds?: number } = {}
): Promise<string> {
  const override = pollOverrideMs();
  let intervalMs =
    override ?? (options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000;
  const deadline =
    Date.now() +
    (options.expiresInSeconds !== undefined
      ? options.expiresInSeconds * 1000
      : MAX_WAIT_MS);
  for (let first = true; Date.now() < deadline; first = false) {
    if (!first) await sleep(intervalMs);
    const response = await post("/api/auth/device/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CLIENT_ID,
    });
    const token = (await response
      .json()
      .catch(() => ({}))) as DeviceTokenResponse;
    if (typeof token.access_token === "string" && token.access_token !== "") {
      return token.access_token;
    }
    if (token.error === "authorization_pending") continue;
    if (token.error === "slow_down") {
      if (override === undefined) intervalMs += 5000;
      continue;
    }
    if (token.error === undefined && !response.ok) {
      throw new CommandError(
        "cloud_api_error",
        `Manufact Cloud could not check the device code (${response.status}).`
      );
    }
    throw tokenError(token.error);
  }
  throw new CommandError(
    "device_code_expired",
    "The device code expired before it was approved.",
    undefined,
    [{ description: "Start a new login", command: "mcp-use login" }]
  );
}

function tokenError(error: unknown): CommandError {
  const retry = [
    { description: "Start a new login", command: "mcp-use login" },
  ];
  if (error === "access_denied") {
    return new CommandError(
      "login_denied",
      "The device login was denied.",
      undefined,
      retry
    );
  }
  if (error === "expired_token") {
    return new CommandError(
      "device_code_expired",
      "The device code expired before it was approved.",
      undefined,
      retry
    );
  }
  // Device codes are bearer credentials. Don't echo Cloud's diagnostic: an
  // intermediary may reflect the submitted code in it.
  return new CommandError(
    "device_code_invalid",
    "The device code is invalid or has already been used.",
    undefined,
    retry
  );
}

function pollOverrideMs(): number | undefined {
  const raw = process.env[POLL_INTERVAL_VARIABLE];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function post(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${cloudAuthUrl()}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new CommandError(
      "cloud_unreachable",
      `Could not reach Manufact Cloud at ${cloudAuthUrl()}: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
