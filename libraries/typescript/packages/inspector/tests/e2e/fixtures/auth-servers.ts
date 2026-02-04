/**
 * Auth Test Servers Manager
 *
 * Manages lifecycle of all authentication test servers.
 * Use this to start/stop all auth servers for E2E testing.
 */

import { ApiKeyServerHelper, createApiKeyServer } from "./api-key-server.js";
import {
  CustomHeaderServerHelper,
  createCustomHeaderServer,
} from "./custom-header-server.js";
import { OAuthMockServerHelper, OAUTH_PROVIDERS } from "./oauth-mock-server.js";

export class AuthServersManager {
  private apiKeyServerHelper: ApiKeyServerHelper;
  private customHeaderServerHelper: CustomHeaderServerHelper;
  private oauthServers: Map<string, OAuthMockServerHelper>;
  private apiKeyServer: any;
  private customHeaderServer: any;

  constructor() {
    this.apiKeyServerHelper = new ApiKeyServerHelper(3003);
    this.customHeaderServerHelper = new CustomHeaderServerHelper(3004);
    this.oauthServers = new Map();

    // Initialize OAuth servers for each provider
    for (const providerKey of Object.keys(OAUTH_PROVIDERS)) {
      this.oauthServers.set(
        providerKey,
        new OAuthMockServerHelper(providerKey)
      );
    }
  }

  /**
   * Start all authentication test servers
   */
  async startAll() {
    console.log("Starting authentication test servers...");

    try {
      // Start API Key server
      this.apiKeyServer = createApiKeyServer(3003);
      await this.apiKeyServer.listen(3003);
      console.log("✓ API Key server started on port 3003");

      // Start Custom Header server
      this.customHeaderServer = createCustomHeaderServer(3004);
      await this.customHeaderServer.listen(3004);
      console.log("✓ Custom Header server started on port 3004");

      // Start OAuth mock servers
      for (const [_providerKey, helper] of this.oauthServers.entries()) {
        try {
          await helper.start();
          console.log(`✓ OAuth server for ${helper.getProviderName()} started`);
        } catch (error) {
          console.error(
            `✗ Failed to start OAuth server for ${helper.getProviderName()}:`,
            error
          );
        }
      }

      console.log("All authentication test servers started successfully!");
    } catch (error) {
      console.error("Failed to start authentication test servers:", error);
      throw error;
    }
  }

  /**
   * Stop all authentication test servers
   */
  async stopAll() {
    console.log("Stopping authentication test servers...");

    // Stop OAuth servers
    for (const [_providerKey, helper] of this.oauthServers.entries()) {
      try {
        await helper.stop();
        console.log(`✓ OAuth server for ${helper.getProviderName()} stopped`);
      } catch (error) {
        console.error(
          `✗ Failed to stop OAuth server for ${helper.getProviderName()}:`,
          error
        );
      }
    }

    // Note: API Key and Custom Header servers don't have explicit stop methods
    console.log("All authentication test servers stopped!");
  }

  /**
   * Get helper for API Key server
   */
  getApiKeyHelper(): ApiKeyServerHelper {
    return this.apiKeyServerHelper;
  }

  /**
   * Get helper for Custom Header server
   */
  getCustomHeaderHelper(): CustomHeaderServerHelper {
    return this.customHeaderServerHelper;
  }

  /**
   * Get helper for OAuth server
   */
  getOAuthHelper(providerKey: string): OAuthMockServerHelper | undefined {
    return this.oauthServers.get(providerKey);
  }

  /**
   * Get all OAuth provider keys
   */
  getOAuthProviders(): string[] {
    return Array.from(this.oauthServers.keys());
  }
}

// Export for convenience
export { ApiKeyServerHelper, CustomHeaderServerHelper, OAuthMockServerHelper };
