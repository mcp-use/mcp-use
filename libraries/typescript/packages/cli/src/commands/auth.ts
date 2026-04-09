import chalk from "chalk";
import open from "open";
import { McpUseAPI } from "../utils/api.js";
import {
  deleteConfig,
  getApiKey,
  getAuthBaseUrl,
  getWebUrl,
  isLoggedIn,
  readConfig,
  writeConfig,
} from "../utils/config.js";
import type { ProfileInfo } from "../utils/api.js";

const DEVICE_CLIENT_ID = "mcp-use-cli";
const DEVICE_POLL_TIMEOUT = 1800000; // 30 minutes (device codes expire after 30m by default)

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

/**
 * Request a device code from the backend (RFC 8628).
 */
async function requestDeviceCode(authBaseUrl: string): Promise<DeviceCodeResponse> {
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
    throw new Error(`Failed to request device code: ${response.status} ${error}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

/**
 * Poll for the access token until the user approves or the code expires.
 */
async function pollForDeviceToken(
  authBaseUrl: string,
  deviceCode: string,
  intervalSeconds: number
): Promise<string> {
  let pollingInterval = intervalSeconds;
  const deadline = Date.now() + DEVICE_POLL_TIMEOUT;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollingInterval * 1000));

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
          throw new Error(data.error_description || `Device auth error: ${data.error}`);
      }
    }
  }

  throw new Error("Login timed out. Please try again.");
}

/**
 * Prompt user to pick an organization from a numbered list.
 * Returns the selected profile or null if selection fails.
 */
export async function promptOrgSelection(
  profiles: ProfileInfo[],
  defaultProfileId?: string | null
): Promise<ProfileInfo | null> {
  if (profiles.length === 0) return null;

  if (profiles.length === 1) {
    return profiles[0];
  }

  console.log(chalk.cyan.bold("\n🏢 Select an organization:\n"));

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    const marker = p.id === defaultProfileId ? chalk.green(" (current)") : "";
    const slug = p.slug ? chalk.gray(` (${p.slug})`) : "";
    console.log(
      `  ${chalk.white(`${i + 1}.`)} ${p.profile_name}${slug}${marker}`
    );
  }

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const defaultIdx = defaultProfileId
      ? profiles.findIndex((p) => p.id === defaultProfileId)
      : 0;
    const defaultDisplay = defaultIdx >= 0 ? defaultIdx + 1 : 1;

    rl.question(
      chalk.gray(`\nEnter number [${defaultDisplay}]: `),
      (answer) => {
        rl.close();
        const trimmed = answer.trim();
        const idx = trimmed === "" ? defaultIdx : parseInt(trimmed, 10) - 1;
        if (idx >= 0 && idx < profiles.length) {
          resolve(profiles[idx]);
        } else {
          console.log(chalk.yellow("Invalid selection, using default."));
          resolve(profiles[defaultIdx >= 0 ? defaultIdx : 0]);
        }
      }
    );
  });
}

/**
 * Login command using OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Supports three modes:
 *   - Interactive device flow (default): opens browser, user enters a code
 *   - --api-key <key>: non-interactive, stores the given key directly
 *   - MCP_USE_API_KEY env var: same as --api-key (for CI/CD)
 */
export async function loginCommand(options?: {
  silent?: boolean;
  apiKey?: string;
}): Promise<void> {
  try {
    // Non-interactive: --api-key flag or MCP_USE_API_KEY env var
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
          console.log(chalk.gray("  (could not verify key — will be checked on next command)"));
        }
      }
      return;
    }

    // Check if already logged in
    if (await isLoggedIn()) {
      if (!options?.silent) {
        console.log(
          chalk.yellow(
            "You are already logged in. Run 'npx mcp-use logout' first if you want to login with a different account."
          )
        );
      }
      return;
    }

    console.log(chalk.cyan.bold("Logging in to mcp-use cloud...\n"));

    const authBaseUrl = await getAuthBaseUrl();

    // Step 1: Request device + user codes
    const deviceResp = await requestDeviceCode(authBaseUrl);
    const { device_code, user_code, verification_uri, verification_uri_complete, interval } = deviceResp;

    // Format user code with a dash for readability if it's 8 chars
    const displayCode = user_code.length === 8
      ? `${user_code.slice(0, 4)}-${user_code.slice(4)}`
      : user_code;

    console.log(chalk.white("  Visit: ") + chalk.cyan(verification_uri));
    console.log(chalk.white("  Code:  ") + chalk.bold.white(displayCode));
    console.log();

    // Open browser (use verification_uri_complete if available so the code is pre-filled)
    const urlToOpen = verification_uri_complete || verification_uri;
    try {
      await open(urlToOpen);
      console.log(chalk.gray("  Browser opened. Waiting for approval..."));
    } catch {
      console.log(chalk.gray("  Open the URL above in your browser."));
    }

    // Step 2: Poll until the user approves
    const accessToken = await pollForDeviceToken(authBaseUrl, device_code, interval || 5);

    console.log(chalk.gray("\n  Creating persistent API key..."));

    // Step 3: Use access token to create a long-lived mcp_ API key
    const api = await McpUseAPI.create();
    const keyResp = await api.createApiKeyWithAccessToken(accessToken, "CLI");

    await writeConfig({ apiKey: keyResp.key });

    console.log(chalk.green.bold("\n✓ Successfully logged in!"));

    // Step 4: Show user info and select organization
    try {
      const freshApi = await McpUseAPI.create();
      const authInfo = await freshApi.testAuth();

      console.log(chalk.cyan.bold("\nCurrent user:\n"));
      console.log(chalk.white("  Email:   ") + chalk.cyan(authInfo.email));
      console.log(chalk.white("  User ID: ") + chalk.gray(authInfo.user_id));

      const storedKey = await getApiKey();
      if (storedKey) {
        const masked = storedKey.substring(0, 8) + "...";
        console.log(chalk.white("  API Key: ") + chalk.gray(masked));
      }

      const profiles = authInfo.profiles ?? [];
      if (profiles.length > 0) {
        let selectedProfile: ProfileInfo | null = null;

        if (profiles.length === 1) {
          selectedProfile = profiles[0];
        } else {
          selectedProfile = await promptOrgSelection(
            profiles,
            authInfo.default_profile_id
          );
        }

        if (selectedProfile) {
          const config = await readConfig();
          await writeConfig({
            ...config,
            profileId: selectedProfile.id,
            profileName: selectedProfile.profile_name,
            profileSlug: selectedProfile.slug ?? undefined,
          });

          const slug = selectedProfile.slug
            ? chalk.gray(` (${selectedProfile.slug})`)
            : "";
          console.log(
            chalk.white("  Org:     ") +
              chalk.cyan(selectedProfile.profile_name) +
              slug
          );
        }
      }
    } catch {
      console.log(
        chalk.gray(
          `\n  Your API key has been saved to ${chalk.white("~/.mcp-use/config.json")}`
        )
      );
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
    // Check if logged in
    if (!(await isLoggedIn())) {
      console.log(chalk.yellow("⚠️  You are not logged in."));
      return;
    }

    console.log(chalk.cyan.bold("🔓 Logging out...\n"));

    // Note: We can't revoke the API key from the CLI because we'd need the key_id
    // which isn't stored in the config. The API key will remain valid until
    // manually revoked from the web interface.
    // For now, we just delete the local config.

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
    // Check if logged in
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

    // Show organization info
    const config = await readConfig();
    const profiles = authInfo.profiles ?? [];
    if (profiles.length > 0) {
      const activeProfile = profiles.find(
        (p) => p.id === (config.profileId || authInfo.default_profile_id)
      );

      if (activeProfile) {
        const slug = activeProfile.slug
          ? chalk.gray(` (${activeProfile.slug})`)
          : "";
        console.log(
          chalk.white("Org:     ") +
            chalk.cyan(activeProfile.profile_name) +
            slug
        );
      }

      if (profiles.length > 1) {
        console.log(
          chalk.gray(
            `\n  ${profiles.length} organizations available. Use ` +
              chalk.white("npx mcp-use org list") +
              " to see all."
          )
        );
      }
    }
  } catch (error: any) {
    if (error?.status === 401) {
      console.error(chalk.red("\nYour session has expired or your API key is invalid."));
      console.log(chalk.gray(`Run ${chalk.white("mcp-use login")} to re-authenticate.\n`));
    } else {
      console.error(
        chalk.red.bold("\n✗ Failed to get user info:"),
        chalk.red(error instanceof Error ? error.message : "Unknown error")
      );
    }
    process.exit(1);
  }
}
