import chalk from "chalk";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import open from "open";
import { McpUseAPI } from "../utils/api.js";
import {
  deleteConfig,
  getApiKey,
  getWebUrl,
  isLoggedIn,
  writeConfig,
} from "../utils/config.js";

const LOGIN_TIMEOUT = 300000; // 5 minutes

/**
 * Find an available port
 */
async function findAvailablePort(startPort: number = 8765): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.once("listening", () => {
          server.close();
          resolve();
        });
        server.listen(port);
      });
      return port;
    } catch {
      continue;
    }
  }
  throw new Error("No available ports found");
}

/**
 * Start local server to receive OAuth callback
 */
async function startCallbackServer(
  port: number
): Promise<{ server: any; token: Promise<string> }> {
  return new Promise((resolve, reject) => {
    let tokenResolver: ((value: string) => void) | null = null;
    const tokenPromise = new Promise<string>((res) => {
      tokenResolver = res;
    });

    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        if (req.url?.startsWith("/callback")) {
          const url = new URL(req.url, `http://localhost:${port}`);
          const token = url.searchParams.get("token");

          if (token && tokenResolver) {
            // Send success response
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Login Successful</title>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>
                    * {
                      margin: 0;
                      padding: 0;
                      box-sizing: border-box;
                    }
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                      display: flex;
                      justify-content: center;
                      align-items: center;
                      min-height: 100vh;
                      background: #000;
                      padding: 1rem;
                    }
                    .container {
                      width: 100%;
                      max-width: 28rem;
                      padding: 3rem;
                      text-align: center;
                      -webkit-backdrop-filter: blur(40px);
                      border: 1px solid rgba(255, 255, 255, 0.2);
                      border-radius: 1.5rem;
                      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    }
                    .icon-container {
                      display: inline-flex;
                      align-items: center;
                      justify-content: center;
                      width: 6rem;
                      height: 6rem;
                      margin-bottom: 2rem;
                      background: rgba(255, 255, 255, 0.1);
                      backdrop-filter: blur(10px);
                      -webkit-backdrop-filter: blur(10px);
                      border-radius: 50%;
                    }
                    .checkmark {
                      font-size: 4rem;
                      color: #fff;
                      line-height: 1;
                      animation: scaleIn 0.5s ease-out;
                    }
                    @keyframes scaleIn {
                      from {
                        transform: scale(0);
                        opacity: 0;
                      }
                      to {
                        transform: scale(1);
                        opacity: 1;
                      }
                    }
                    h1 {
                      color: #fff;
                      margin: 0 0 1rem 0;
                      font-size: 2.5rem;
                      font-weight: 700;
                      letter-spacing: -0.025em;
                    }
                    p {
                      color: rgba(255, 255, 255, 0.8);
                      margin: 0 0 2rem 0;
                      font-size: 1.125rem;
                      line-height: 1.5;
                    }
                    .spinner {
                      display: inline-block;
                      width: 2rem;
                      height: 2rem;
                      border: 3px solid rgba(255, 255, 255, 0.3);
                      border-top-color: #fff;
                      border-radius: 50%;
                      animation: spin 0.8s linear infinite;
                    }
                    @keyframes spin {
                      to { transform: rotate(360deg); }
                    }
                    .footer {
                      margin-top: 2rem;
                      color: rgba(255, 255, 255, 0.6);
                      font-size: 0.875rem;
                    }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <h1>Authentication Successful!</h1>
                    <p>You can now close this window and return to the CLI.</p>
                  </div>
                </body>
              </html>
            `);
            tokenResolver(token);
          } else {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Login Failed</title>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>
                    * {
                      margin: 0;
                      padding: 0;
                      box-sizing: border-box;
                    }
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                      display: flex;
                      justify-content: center;
                      align-items: center;
                      min-height: 100vh;
                      background: #000;
                      padding: 1rem;
                    }
                    .container {
                      width: 100%;
                      max-width: 28rem;
                      padding: 3rem;
                      text-align: center;
                      background: rgba(255, 255, 255, 0.1);
                      backdrop-filter: blur(40px);
                      -webkit-backdrop-filter: blur(40px);
                      border: 1px solid rgba(255, 255, 255, 0.2);
                      border-radius: 1.5rem;
                      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    }
                    .icon-container {
                      display: inline-flex;
                      align-items: center;
                      justify-content: center;
                      width: 6rem;
                      height: 6rem;
                      margin-bottom: 2rem;
                      background: rgba(255, 255, 255, 0.1);
                      backdrop-filter: blur(10px);
                      -webkit-backdrop-filter: blur(10px);
                      border-radius: 50%;
                    }
                    .cross {
                      font-size: 4rem;
                      color: #fff;
                      line-height: 1;
                    }
                    h1 {
                      color: #fff;
                      margin: 0 0 1rem 0;
                      font-size: 2.5rem;
                      font-weight: 700;
                      letter-spacing: -0.025em;
                    }
                    p {
                      color: rgba(255, 255, 255, 0.8);
                      margin: 0;
                      font-size: 1.125rem;
                      line-height: 1.5;
                    }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="icon-container">
                      <div class="cross">✗</div>
                    </div>
                    <h1>Login Failed</h1>
                    <p>No token received. Please try again.</p>
                  </div>
                </body>
              </html>
            `);
          }
        }
      }
    );

    server.listen(port, () => {
      resolve({ server, token: tokenPromise });
    });

    server.on("error", reject);
  });
}

/**
 * Login command - opens browser for OAuth flow
 */
export async function loginCommand(): Promise<void> {
  try {
    // Check if already logged in
    if (await isLoggedIn()) {
      console.log(
        chalk.yellow("⚠️  You are already logged in. Run 'mcp-use logout' first if you want to login with a different account.")
      );
      return;
    }

    console.log(chalk.cyan.bold("🔐 Logging in to mcp-use cloud...\n"));

    // Find available port
    const port = await findAvailablePort();
    const redirectUri = `http://localhost:${port}/callback`;

    console.log(chalk.gray(`Starting local server on port ${port}...`));

    // Start callback server
    const { server, token } = await startCallbackServer(port);

    // Get the web URL (respects NEXT_PUBLIC_API_URL)
    const webUrl = await getWebUrl();
    const loginUrl = `${webUrl}/auth/cli?redirect_uri=${encodeURIComponent(redirectUri)}`;

    console.log(chalk.gray(`Opening browser to ${webUrl}/auth/cli...\n`));
    console.log(
      chalk.white(
        "If the browser doesn't open automatically, please visit:\n" +
          chalk.cyan(loginUrl)
      )
    );

    // Open browser
    await open(loginUrl);

    console.log(
      chalk.gray("\nWaiting for authentication... (this may take a moment)")
    );

    // Wait for token with timeout
    const jwtToken = await Promise.race([
      token,
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("Login timeout - please try again")),
          LOGIN_TIMEOUT
        )
      ),
    ]);

    // Close server
    server.close();

    console.log(chalk.gray("Received authentication token, creating API key..."));

    // Create API key using JWT token
    const api = await McpUseAPI.create();
    const apiKeyResponse = await api.createApiKey(jwtToken, "CLI");

    // Save API key to config
    await writeConfig({
      apiKey: apiKeyResponse.api_key,
    });

    console.log(chalk.green.bold("\n✓ Successfully logged in!"));
    console.log(
      chalk.gray(
        `\nYour API key has been saved to ${chalk.white("~/.mcp-use/config.json")}`
      )
    );
    console.log(
      chalk.gray("You can now deploy your MCP servers with " + chalk.white("mcp-use deploy"))
    );
    
    // Exit successfully
    process.exit(0);
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Login failed:"),
      chalk.red(
        error instanceof Error ? error.message : "Unknown error"
      )
    );
    process.exit(1);
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
      chalk.red(
        error instanceof Error ? error.message : "Unknown error"
      )
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
        chalk.gray("Run " + chalk.white("mcp-use login") + " to get started.")
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
      // Show first and last 4 characters
      const masked =
        apiKey.substring(0, 8) +
        "..." +
        apiKey.substring(apiKey.length - 4);
      console.log(chalk.white("API Key: ") + chalk.gray(masked));
    }
  } catch (error) {
    console.error(
      chalk.red.bold("\n✗ Failed to get user info:"),
      chalk.red(
        error instanceof Error ? error.message : "Unknown error"
      )
    );
    process.exit(1);
  }
}

