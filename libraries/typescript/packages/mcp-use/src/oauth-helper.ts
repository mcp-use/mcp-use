/**
 * OAuth helper for browser-based MCP authentication
 *
 * This helper provides OAuth 2.0 authorization code flow support for MCP servers
 * that require authentication, such as Linear's MCP server.
 */

export interface OAuthConfig {
  clientId?: string // Optional - will use dynamic registration if not provided
  redirectUri: string
  scope?: string
  state?: string
  clientName?: string // For dynamic registration
}

export interface OAuthDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  response_types_supported: string[]
  grant_types_supported: string[]
  code_challenge_methods_supported: string[]
  token_endpoint_auth_methods_supported?: string[]
}

export interface ClientRegistration {
  client_id: string
  client_secret?: string
  registration_access_token?: string
  registration_client_uri?: string
  client_id_issued_at?: number
  client_secret_expires_at?: number
}

export interface OAuthResult {
  access_token: string
  token_type: string
  expires_at?: number | null
  refresh_token?: string | null
  scope?: string | null
}

export interface OAuthState {
  isRequired: boolean
  isAuthenticated: boolean
  isAuthenticating: boolean
  isCompletingOAuth: boolean
  authError: string | null
  oauthTokens: OAuthResult | null
}

export class OAuthHelper {
  private config: OAuthConfig
  private discovery?: OAuthDiscovery
  private state: OAuthState
  private clientRegistration?: ClientRegistration

  constructor(config: OAuthConfig) {
    this.config = config
    this.state = {
      isRequired: false,
      isAuthenticated: false,
      isAuthenticating: false,
      isCompletingOAuth: false,
      authError: null,
      oauthTokens: null,
    }
  }

  /**
   * Get current OAuth state
   */
  getState(): OAuthState {
    return { ...this.state }
  }

  /**
   * Check if a server requires authentication by pinging the URL
   */
  async checkAuthRequired(serverUrl: string): Promise<boolean> {
    console.log('🔍 [OAuthHelper] Checking auth requirement for:', serverUrl)

    try {
      const response = await fetch(serverUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })

      console.log('🔍 [OAuthHelper] Auth check response:', {
        status: response.status,
        statusText: response.statusText,
        url: serverUrl,
      })

      // 401 Unauthorized, 403 Forbidden, or 400 Bad Request means auth is required
      if (response.status === 401 || response.status === 403 || response.status === 400) {
        console.log('🔐 [OAuthHelper] Authentication required for:', serverUrl)
        return true
      }

      // Any other response (200, 404, 500, etc.) means no auth required
      console.log('✅ [OAuthHelper] No authentication required for:', serverUrl)
      return false
    }
    catch (error: any) {
      console.warn('⚠️ [OAuthHelper] Could not check auth requirement for:', serverUrl, error)

      // Handle specific error types
      if (error.name === 'TypeError'
        && (error.message?.includes('CORS') || error.message?.includes('Failed to fetch'))) {
        console.log('🔍 [OAuthHelper] CORS blocked direct check, using heuristics for:', serverUrl)
        return this.checkAuthByHeuristics(serverUrl)
      }

      if (error.name === 'AbortError') {
        console.log('⏰ [OAuthHelper] Request timeout, assuming no auth required for:', serverUrl)
        return false
      }

      // If we can't reach the server at all, try heuristics
      return this.checkAuthByHeuristics(serverUrl)
    }
  }

  /**
   * Fallback heuristics for determining auth requirements when direct checking fails
   */
  private checkAuthByHeuristics(serverUrl: string): boolean {
    console.log('🔍 [OAuthHelper] Using heuristics to determine auth for:', serverUrl)

    // Known patterns that typically require auth
    const authRequiredPatterns = [
      /api\.githubcopilot\.com/i, // GitHub Copilot
      /api\.github\.com/i, // GitHub API
      /.*\.googleapis\.com/i, // Google APIs
      /api\.openai\.com/i, // OpenAI
      /api\.anthropic\.com/i, // Anthropic
      /.*\.atlassian\.net/i, // Atlassian (Jira, Confluence)
      /.*\.slack\.com/i, // Slack
      /api\.notion\.com/i, // Notion
      /api\.linear\.app/i, // Linear
    ]

    // Known patterns that typically don't require auth (public MCP servers)
    const noAuthPatterns = [
      /localhost/i, // Local development
      /127\.0\.0\.1/, // Local development
      /\.local/i, // Local development
      /mcp\..*\.com/i, // Generic MCP server pattern (often public)
    ]

    // Check no-auth patterns first
    for (const pattern of noAuthPatterns) {
      if (pattern.test(serverUrl)) {
        console.log('✅ [OAuthHelper] Heuristic: No auth required (matches no-auth pattern):', serverUrl)
        return false
      }
    }

    // Check auth-required patterns
    for (const pattern of authRequiredPatterns) {
      if (pattern.test(serverUrl)) {
        console.log('🔐 [OAuthHelper] Heuristic: Auth required (matches auth pattern):', serverUrl)
        return true
      }
    }

    // Default: assume no auth required for unknown patterns
    console.log('❓ [OAuthHelper] Heuristic: Unknown pattern, assuming no auth required:', serverUrl)
    return false
  }

  /**
   * Discover OAuth configuration from a server
   */
  async discoverOAuthConfig(serverUrl: string): Promise<OAuthDiscovery | undefined> {
    try {
      const discoveryUrl = `${serverUrl}/.well-known/oauth-authorization-server`
      console.log('🔍 [OAuthHelper] Attempting OAuth discovery at:', discoveryUrl)
      
      const response = await fetch(discoveryUrl)

      if (!response.ok) {
        console.error('❌ [OAuthHelper] OAuth discovery failed:', {
          status: response.status,
          statusText: response.statusText,
          url: discoveryUrl
        })
        throw new Error(`OAuth discovery failed: ${response.status} ${response.statusText}`)
      }

      this.discovery = await response.json()
      console.log('✅ [OAuthHelper] OAuth discovery successful:', {
        authorization_endpoint: this.discovery?.authorization_endpoint,
        token_endpoint: this.discovery?.token_endpoint,
        registration_endpoint: this.discovery?.registration_endpoint
      })
      return this.discovery
    }
    catch (error) {
      console.error('❌ [OAuthHelper] OAuth discovery error:', error)
      throw new Error(`Failed to discover OAuth configuration: ${error}`)
    }
  }

  /**
   * Register a new OAuth client dynamically
   */
  async registerClient(_serverUrl: string): Promise<ClientRegistration> {
    if (!this.discovery) {
      throw new Error('OAuth discovery not performed. Call discoverOAuthConfig first.')
    }

    if (!this.discovery.registration_endpoint) {
      throw new Error('Server does not support dynamic client registration')
    }

    try {
      const registrationData = {
        client_name: this.config.clientName || 'MCP Use Example',
        redirect_uris: [this.config.redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Use public client (no secret)
        scope: this.config.scope || 'read write',
      }

      console.log('🔐 [OAuthHelper] Registering OAuth client dynamically:', {
        registration_endpoint: this.discovery.registration_endpoint,
        client_name: registrationData.client_name,
        redirect_uri: this.config.redirectUri,
      })

      const response = await fetch(this.discovery.registration_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registrationData),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Client registration failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      this.clientRegistration = await response.json()
      console.log('✅ [OAuthHelper] Client registered successfully:', {
        client_id: this.clientRegistration?.client_id,
        client_secret: this.clientRegistration?.client_secret ? '***' : 'none',
      })

      return this.clientRegistration!
    }
    catch (error) {
      console.error('❌ [OAuthHelper] Client registration failed:', error)
      throw new Error(`Failed to register OAuth client: ${error}`)
    }
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  generateAuthUrl(serverUrl: string, additionalParams?: Record<string, string>): string {
    if (!this.discovery) {
      throw new Error('OAuth discovery not performed. Call discoverOAuthConfig first.')
    }

    if (!this.clientRegistration) {
      throw new Error('Client not registered. Call registerClient first.')
    }

    const params = new URLSearchParams({
      client_id: this.clientRegistration.client_id,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scope || 'read',
      state: this.config.state || this.generateState(),
      ...additionalParams,
    })

    return `${this.discovery.authorization_endpoint}?${params.toString()}`
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(
    serverUrl: string,
    code: string,
    codeVerifier?: string,
  ): Promise<OAuthResult> {
    if (!this.discovery) {
      throw new Error('OAuth discovery not performed. Call discoverOAuthConfig first.')
    }

    if (!this.clientRegistration) {
      throw new Error('Client not registered. Call registerClient first.')
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientRegistration.client_id,
      code,
      redirect_uri: this.config.redirectUri,
    })

    if (codeVerifier) {
      body.append('code_verifier', codeVerifier)
    }

    const response = await fetch(this.discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${error}`)
    }

    return await response.json()
  }

  /**
   * Handle OAuth callback and extract authorization code
   */
  handleCallback(): { code: string, state: string } | null {
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')

    if (!code || !state) {
      return null
    }

    // Clean up URL
    const url = new URL(window.location.href)
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    window.history.replaceState({}, '', url.toString())

    return { code, state }
  }

  /**
   * Start OAuth flow by opening popup window (similar to your implementation)
   */
  async startOAuthFlow(serverUrl: string): Promise<void> {
    this.setState({
      isAuthenticating: true,
      authError: null,
    })

    try {
      // Step 1: Discover OAuth configuration
      await this.discoverOAuthConfig(serverUrl)

      // Step 2: Register client dynamically
      await this.registerClient(serverUrl)

      // Step 3: Generate authorization URL
      const authUrl = this.generateAuthUrl(serverUrl)

      // Step 4: Open popup window for authentication
      const authWindow = window.open(
        authUrl,
        'mcp-oauth',
        'width=500,height=600,scrollbars=yes,resizable=yes,status=yes,location=yes',
      )

      if (!authWindow) {
        throw new Error('Failed to open authentication window. Please allow popups for this site and try again.')
      }

      console.log('✅ [OAuthHelper] OAuth popup opened successfully')
    }
    catch (error) {
      console.error('❌ [OAuthHelper] Failed to start OAuth flow:', error)
      this.setState({
        isAuthenticating: false,
        authError: error instanceof Error ? error.message : 'Failed to start authentication',
      })
      throw error
    }
  }

  /**
   * Complete OAuth flow by exchanging code for token
   */
  async completeOAuthFlow(serverUrl: string, code: string): Promise<OAuthResult> {
    this.setState({
      isCompletingOAuth: true,
      authError: null,
    })

    try {
      const tokenResponse = await this.exchangeCodeForToken(serverUrl, code)

      this.setState({
        isAuthenticating: false,
        isAuthenticated: true,
        isCompletingOAuth: false,
        authError: null,
        oauthTokens: tokenResponse,
      })

      console.log('✅ [OAuthHelper] OAuth flow completed successfully')
      return tokenResponse
    }
    catch (error) {
      console.error('❌ [OAuthHelper] Failed to complete OAuth flow:', error)
      this.setState({
        isAuthenticating: false,
        isCompletingOAuth: false,
        authError: error instanceof Error ? error.message : 'Failed to complete authentication',
      })
      throw error
    }
  }

  /**
   * Reset authentication state
   */
  resetAuth(): void {
    this.setState({
      isRequired: false,
      isAuthenticated: false,
      isAuthenticating: false,
      isCompletingOAuth: false,
      authError: null,
      oauthTokens: null,
    })
  }

  /**
   * Set OAuth state (internal method)
   */
  private setState(newState: Partial<OAuthState>): void {
    this.state = { ...this.state, ...newState }
  }

  /**
   * Generate a random state parameter for CSRF protection
   */
  private generateState(): string {
    return Math.random().toString(36).substring(2, 15)
      + Math.random().toString(36).substring(2, 15)
  }
}

/**
 * Linear-specific OAuth configuration
 */
export const LINEAR_OAUTH_CONFIG: OAuthConfig = {
  // No clientId needed - will use dynamic client registration
  redirectUri: typeof window !== 'undefined' ? window.location.origin + window.location.pathname : 'http://localhost:5173',
  scope: 'read write',
  clientName: 'MCP Use Example',
}

/**
 * Helper function to create OAuth-enabled MCP configuration
 */
export function createOAuthMCPConfig(serverUrl: string, accessToken: string) {
  return {
    mcpServers: {
      linear: {
        url: serverUrl,
        authToken: accessToken,
        transport: 'sse',
      },
    },
  }
}
