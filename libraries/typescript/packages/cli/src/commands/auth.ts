import chalk from "chalk";
import open from "open";
import { ApiUnauthorizedError, McpUseAPI } from "../utils/api.js";
import {
  deleteConfig,
  getApiKey,
  getAuthBaseUrl,
  isLoggedIn,
  readConfig,
  writeConfig,
} from "../utils/config.js";
import { handleCommandError } from "../utils/errors.js";
import type { AuthTestResponse, OrgInfo } from "../utils/api.js";

const DEVICE_CLIENT_ID = "mcp-use-cli";
const DEVICE_POLL_TIMEOUT = 1800000; // 30 minutes

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function requestDeviceCode(
  authBaseUrl: string
): Promise<DeviceCodeResponse> {
  const url = `${authBaseUrl}/api/auth/device/code`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: DEVICE_CLIENT_ID,
      scope: "openid profile email",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to request device code: ${response.status} ${error}`
    );
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

async function pollForDeviceToken(
  authBaseUrl: string,
  deviceCode: string,
  intervalSeconds: number
): Promise<string> {
  let pollingInterval = intervalSeconds;
  const deadline = Date.now() + DEVICE_POLL_TIMEOUT;

  while (Date.now() < deadline) {
    const delayMs = pollingInterval * 1000;
    await new Promise((r) => setTimeout(r, delayMs));

    const url = `${authBaseUrl}/api/auth/device/token`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: DEVICE_CLIENT_ID,
      }),
    });

    const data = (await response.json()) as DeviceTokenResponse;

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error) {
      switch (data.error) {
        case "authorization_pending":
          break;
        case "slow_down":
          pollingInterval += 5;
          break;
        case "access_denied":
          throw new Error("Authorization was denied by the user.");
        case "expired_token":
          throw new Error("The device code has expired. Please try again.");
        default:
          throw new Error(
            data.error_description || `Device auth error: ${data.error}`
          );
      }
    }
  }

  throw new Error("Login timed out. Please try again.");
}

/**
 * Resolve an org identifier (slug, id, or case-insensitive name) against a list.
 * Returns null if no match.
 */
export function resolveOrgFromOption(
  orgs: OrgInfo[],
  identifier: string
): OrgInfo | null {
  const needle = identifier.trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();
  return (
    orgs.find(
      (o) =>
        o.slug === needle || o.id === needle || o.name.toLowerCase() === lower
    ) ?? null
  );
}

/**
 * Prompt user to pick an organization from a numbered list.
 */
export async function promptOrgSelection(
  orgs: OrgInfo[],
  defaultOrgId?: string | null
): Promise<OrgInfo | null> {
  if (orgs.length === 0) return null;

  if (orgs.length === 1) {
    return orgs[0];
  }

  console.log(chalk.cyan.bold("\n🏢 Select an organization:\n"));

  for (let i = 0; i < orgs.length; i++) {
    const o = orgs[i];
    const marker = o.id === defaultOrgId ? chalk.green(" (current)") : "";
    const slug = o.slug ? chalk.gray(` (${o.slug})`) : "";
    console.log(`  ${chalk.white(`${i + 1}.`)} ${o.name}${slug}${marker}`);
  }

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const defaultIdx = defaultOrgId
      ? orgs.findIndex((o) => o.id === defaultOrgId)
      : 0;
    const defaultDisplay = defaultIdx >= 0 ? defaultIdx + 1 : 1;

    rl.question(
      chalk.gray(`\nEnter number [${defaultDisplay}]: `),
      (answer) => {
        rl.close();
        const trimmed = answer.trim();
        const idx = trimmed === "" ? defaultIdx : parseInt(trimmed, 10) - 1;
        if (idx >= 0 && idx < orgs.length) {
          resolve(orgs[idx]);
        } else {
          console.log(chalk.yellow("Invalid selection, using default."));
          resolve(orgs[defaultIdx >= 0 ? defaultIdx : 0]);
        }
      }
    );
  });
}

/**
 * Login command using OAuth 2.0 Device Authorization Grant (RFC 8628).
 */
export async function loginCommand(options?: {
  silent?: boolean;
  apiKey?: string;
  org?: string;
}): Promise<void> {
  try {
    const directKey = options?.apiKey || process.env.MCP_USE_API_KEY;
    if (directKey) {
      await writeConfig({ apiKey: directKey });
      if (!options?.silent) {
        console.log(chalk.green.bold("✓ API key saved."));
        try {
          const api = await McpUseAPI.create();
          const authInfo = await api.testAuth();
          console.log(chalk.gray(`  Authenticated as ${authInfo.email}`));
        } catch {
          console.log(
            chalk.gray(
              "  (could not verify key — will be checked on next command)"
            )
          );
        }
      }
      return;
    }

    if (await isLoggedIn()) {
      let needsReauth = false;
      try {
        await (await McpUseAPI.create()).testAuth();
      } catch (e) {
        // Only a 401 means the stored key is actually bad. Network/disk
        // errors get the benefit of the doubt so offline users aren't
        // bounced into re-auth when we can't verify.
        if (e instanceof ApiUnauthorizedError) {
          needsReauth = true;
        }
      }

      if (!needsReauth) {
        if (!options?.silent) {
          console.log(
            chalk.yellow(
              "You are already logged in. Run 'npx mcp-use logout' first if you want to login with a different account."
            )
          );
        }
        return;
      }

      if (!options?.silent) {
        console.log(
          chalk.yellow(
            "⚠️  Stored credentials are invalid or expired. Re-authenticating..."
          )
        );
      }
      await deleteConfig();
    }

    console.log(chalk.cyan.bold("Logging in to mcp-use cloud...\n"));

    const authBaseUrl = await getAuthBaseUrl();

    const deviceResp = await requestDeviceCode(authBaseUrl);
    const {
      device_code,
      user_code,
      verification_uri,
      verification_uri_complete,
      interval,
    } = deviceResp;

    const displayCode =
      user_code.length === 8
        ? `${user_code.slice(0, 4)}-${user_code.slice(4)}`
        : user_code;

    console.log(chalk.white("  Visit: ") + chalk.cyan(verification_uri));
    console.log(chalk.white("  Code:  ") + chalk.bold.white(displayCode));
    console.log();

    const urlToOpen = verification_uri_complete || verification_uri;
    try {
      await open(urlToOpen);
      console.log(chalk.gray("  Browser opened. Waiting for approval..."));
    } catch {
      console.log(chalk.gray("  Open the URL above in your browser."));
    }

    const accessToken = await pollForDeviceToken(
      authBaseUrl,
      device_code,
      interval || 5
    );

    console.log(chalk.gray("\n  Creating persistent API key..."));

    const api = await McpUseAPI.create();
    const keyResp = await api.createApiKeyWithAccessToken(accessToken, "CLI");

    await writeConfig({ apiKey: keyResp.key });

    console.log(chalk.green.bold("\n✓ Successfully logged in!"));

    let authInfo: AuthTestResponse | null = null;
    try {
      const freshApi = await McpUseAPI.create();
      authInfo = await freshApi.testAuth();
    } catch {
      console.log(
        chalk.gray(
          `\n  Your API key has been saved to ${chalk.white("~/.mcp-use/config.json")}`
        )
      );
    }

    if (authInfo) {
      console.log(chalk.cyan.bold("\nCurrent user:\n"));
      console.log(chalk.white("  Email:   ") + chalk.cyan(authInfo.email));
      console.log(chalk.white("  User ID: ") + chalk.gray(authInfo.user_id));

      const storedKey = await getApiKey();
      if (storedKey) {
        const masked = storedKey.substring(0, 8) + "...";
        console.log(chalk.white("  API Key: ") + chalk.gray(masked));
      }

      const orgs = authInfo.orgs ?? [];
      if (orgs.length > 0) {
        let selectedOrg: OrgInfo | null = null;

        if (options?.org) {
          selectedOrg = resolveOrgFromOption(orgs, options.org);
          if (!selectedOrg) {
            throw new Error(
              `Organization "${options.org}" not found. Run 'npx mcp-use org list' after logging in to see available organizations.`
            );
          }
        } else if (orgs.length === 1) {
          selectedOrg = orgs[0];
        } else if (!process.stdin.isTTY) {
          throw new Error(
            "Multiple organizations available and no TTY for interactive selection. Re-run with --org <slug|id|name> to pick one non-interactively."
          );
        } else {
          selectedOrg = await promptOrgSelection(orgs, authInfo.default_org_id);
        }

        if (selectedOrg) {
          const config = await readConfig();
          await writeConfig({
            ...config,
            orgId: selectedOrg.id,
            orgName: selectedOrg.name,
            orgSlug: selectedOrg.slug ?? undefined,
          });

          const slug = selectedOrg.slug
            ? chalk.gray(` (${selectedOrg.slug})`)
            : "";
          console.log(
            chalk.white("  Org:     ") + chalk.cyan(selectedOrg.name) + slug
          );
        }
      }
    }

    console.log(
      chalk.gray(
        "\n  Deploy your MCP servers with " + chalk.white("npx mcp-use deploy")
      )
    );
    console.log(
      chalk.gray("  To logout, run " + chalk.white("npx mcp-use logout"))
    );
  } catch (error) {
    throw new Error(
      `Login failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Logout command - revokes API key and deletes config
 */
export async function logoutCommand(): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.yellow("⚠️  You are not logged in."));
      return;
    }

    console.log(chalk.cyan.bold("🔓 Logging out...\n"));

    await deleteConfig();

    console.log(chalk.green.bold("✓ Successfully logged out!"));
    console.log(
      chalk.gray(
        "\nYour local config has been deleted. The API key will remain active until revoked from the web interface."
      )
    );
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Logout failed:"),
      chalk.red(error instanceof Error ? error.message : "Unknown error")
    );
    process.exit(1);
  }
}

/**
 * Whoami command - shows current user info
 */
export async function whoamiCommand(): Promise<void> {
  try {
    if (!(await isLoggedIn())) {
      console.log(chalk.yellow("⚠️  You are not logged in."));
      console.log(
        chalk.gray(
          "Run " + chalk.white("npx mcp-use login") + " to get started."
        )
      );
      return;
    }

    console.log(chalk.cyan.bold("👤 Current user:\n"));

    const api = await McpUseAPI.create();
    const authInfo = await api.testAuth();

    console.log(chalk.white("Email:   ") + chalk.cyan(authInfo.email));
    console.log(chalk.white("User ID: ") + chalk.gray(authInfo.user_id));

    const apiKey = await getApiKey();
    if (apiKey) {
      const masked = apiKey.substring(0, 6) + "...";
      console.log(chalk.white("API Key: ") + chalk.gray(masked));
    }

    const config = await readConfig();
    const orgs = authInfo.orgs ?? [];
    if (orgs.length > 0) {
      const activeOrg = orgs.find(
        (o) => o.id === (config.orgId || authInfo.default_org_id)
      );

      if (activeOrg) {
        const slug = activeOrg.slug ? chalk.gray(` (${activeOrg.slug})`) : "";
        console.log(
          chalk.white("Org:     ") + chalk.cyan(activeOrg.name) + slug
        );
      }

      if (orgs.length > 1) {
        console.log(
          chalk.gray(
            `\n  ${orgs.length} organizations available. Use ` +
              chalk.white("npx mcp-use org list") +
              " to see all."
          )
        );
      }
    }
  } catch (error) {
    handleCommandError(error, "Failed to get user info");
  }
}
