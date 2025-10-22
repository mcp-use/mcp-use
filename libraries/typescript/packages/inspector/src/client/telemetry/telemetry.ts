import type posthog from 'posthog-js'
import type { BaseTelemetryEvent } from './events.js'
import { logger } from '../utils/logger.js'
import { MCPInspectorOpenEvent } from './events.js'
import { getPackageVersion } from './utils.js'

// Environment detection function
function isBrowserEnvironment(): boolean {
  try {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
  }
  catch {
    return false
  }
}

// Simple Scarf event logger implementation
class ScarfEventLogger {
  private endpoint: string
  private timeout: number

  constructor(endpoint: string, timeout: number = 3000) {
    this.endpoint = endpoint
    this.timeout = timeout
  }

  async logEvent(properties: Record<string, any>): Promise<void> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(properties),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
    }
    catch (error) {
      // Silently fail - telemetry should not break the application
      logger.debug(`Failed to send Scarf event: ${error}`)
    }
  }
}

function getCacheKey(key: string): string {
  return `mcp_inspector_telemetry_${key}`
}

export class Telemetry {
  private static instance: Telemetry | null = null

  private readonly PROJECT_API_KEY = 'phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI'
  private readonly HOST = 'https://eu.i.posthog.com'
  private readonly SCARF_GATEWAY_URL = 'https://mcpuse.gateway.scarf.sh/events-inspector'
  private readonly UNKNOWN_USER_ID = 'UNKNOWN_USER_ID'

  private _currUserId: string | null = null
  private _posthogClient: typeof posthog | null = null
  private _scarfClient: ScarfEventLogger | null = null
  private _source: string = 'inspector'
  private _initialized: boolean = false

  private constructor() {
    // Check if we're in a browser environment first
    const isBrowser = isBrowserEnvironment()

    // Safely access environment variables or check localStorage
    const telemetryDisabled = this.isTelemetryDisabled()

    // Check for source from localStorage or default to 'inspector'
    this._source = this.getStoredSource() || 'inspector'

    if (telemetryDisabled) {
      this._posthogClient = null
      this._scarfClient = null
      logger.debug('Telemetry disabled via environment variable or localStorage')
    }
    else if (!isBrowser) {
      this._posthogClient = null
      this._scarfClient = null
      logger.debug('Telemetry disabled - non-browser environment detected')
    }
    else {
      logger.info('Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false to disable.')

      // Initialize PostHog asynchronously
      this.initializePostHog()

      // Initialize Scarf
      try {
        this._scarfClient = new ScarfEventLogger(this.SCARF_GATEWAY_URL, 3000)
      }
      catch (e) {
        logger.warn(`Failed to initialize Scarf telemetry: ${e}`)
        this._scarfClient = null
      }
    }
  }

  private async initializePostHog(): Promise<void> {
    try {
      // Dynamically import posthog-js only in browser environment
      const posthogModule = await import('posthog-js')
      const posthogInstance = posthogModule.default

      // Initialize PostHog
      posthogInstance.init(this.PROJECT_API_KEY, {
        api_host: this.HOST,
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        persistence: 'localStorage',
        loaded: (ph) => {
          logger.debug('PostHog initialized successfully')
          this._posthogClient = ph
          this._initialized = true
        },
      })

      this._posthogClient = posthogInstance
    }
    catch (e) {
      logger.warn(`Failed to initialize PostHog telemetry: ${e}`)
      this._posthogClient = null
    }
  }

  private isTelemetryDisabled(): boolean {
    // Check localStorage
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(getCacheKey('disabled'))
      if (stored === 'true')
        return true
    }
    // Check environment variable (if available)
    if (typeof process !== 'undefined' && process.env?.MCP_USE_ANONYMIZED_TELEMETRY === 'false') {
      return true
    }
    return false
  }

  private getStoredSource(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(getCacheKey('source'))
    }
    return null
  }

  static getInstance(): Telemetry {
    if (!Telemetry.instance) {
      Telemetry.instance = new Telemetry()
    }
    return Telemetry.instance
  }

  /**
   * Set the source identifier for telemetry events.
   * This allows tracking usage from different applications.
   * @param source - The source identifier (e.g., "inspector-web", "inspector-standalone")
   */
  setSource(source: string): void {
    this._source = source
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(getCacheKey('source'), source)
    }
    logger.debug(`Telemetry source set to: ${source}`)
  }

  /**
   * Get the current source identifier.
   */
  getSource(): string {
    return this._source
  }

  get userId(): string {
    if (this._currUserId) {
      return this._currUserId
    }

    // If we're not in a browser environment, just return a static user ID
    if (!isBrowserEnvironment()) {
      this._currUserId = this.UNKNOWN_USER_ID
      return this._currUserId
    }

    try {
      // Check localStorage for existing user ID
      const storedUserId = localStorage.getItem(getCacheKey('user_id'))

      if (storedUserId) {
        this._currUserId = storedUserId
      }
      else {
        // Generate new user ID
        const newUserId = this.generateUserId()
        localStorage.setItem(getCacheKey('user_id'), newUserId)
        this._currUserId = newUserId
        logger.debug(`New user ID created: ${newUserId}`)
      }

      // Track package download on first access
      this.trackPackageDownload({
        triggered_by: 'user_id_property',
      }).catch(e => logger.debug(`Failed to track package download: ${e}`))
    }
    catch (e) {
      logger.debug(`Failed to get/create user ID: ${e}`)
      this._currUserId = this.UNKNOWN_USER_ID
    }

    return this._currUserId
  }

  private generateUserId(): string {
    // Generate a random UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  async capture(event: BaseTelemetryEvent): Promise<void> {
    if (!this._posthogClient && !this._scarfClient) {
      return
    }

    // Wait for PostHog to be initialized
    if (this._posthogClient && !this._initialized) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Send to PostHog
    if (this._posthogClient) {
      try {
        // Add package version, language flag, and source to all events
        const properties = { ...event.properties }
        properties.mcp_use_version = getPackageVersion()
        properties.language = 'typescript'
        properties.source = this._source
        properties.package = 'inspector'

        this._posthogClient.capture(event.name, properties)
      }
      catch (e) {
        logger.debug(`Failed to track PostHog event ${event.name}: ${e}`)
      }
    }

    // Send to Scarf
    if (this._scarfClient) {
      try {
        // Add package version, user_id, language flag, and source to all events
        const properties: Record<string, any> = {}
        properties.mcp_use_version = getPackageVersion()
        properties.user_id = this.userId
        properties.event = event.name
        properties.language = 'typescript'
        properties.source = this._source
        properties.package = 'inspector'

        await this._scarfClient.logEvent(properties)
      }
      catch (e) {
        logger.debug(`Failed to track Scarf event ${event.name}: ${e}`)
      }
    }
  }

  async trackPackageDownload(properties?: Record<string, any>): Promise<void> {
    logger.debug('Tracking package download')
    if (!this._scarfClient) {
      return
    }

    // Skip tracking in non-browser environments
    if (!isBrowserEnvironment()) {
      return
    }

    try {
      const currentVersion = getPackageVersion()
      let shouldTrack = false
      let firstDownload = false

      // Check localStorage for version
      const storedVersion = localStorage.getItem(getCacheKey('download_version'))

      if (!storedVersion) {
        // First download
        shouldTrack = true
        firstDownload = true
        localStorage.setItem(getCacheKey('download_version'), currentVersion)
      }
      else if (currentVersion > storedVersion) {
        // Version upgrade
        shouldTrack = true
        firstDownload = false
        localStorage.setItem(getCacheKey('download_version'), currentVersion)
      }

      if (shouldTrack) {
        logger.debug(`Tracking package download event with properties: ${JSON.stringify(properties)}`)
        // Add package version, user_id, language flag, and source to event
        const eventProperties = { ...(properties || {}) }
        eventProperties.mcp_use_version = currentVersion
        eventProperties.user_id = this.userId
        eventProperties.event = 'package_download'
        eventProperties.first_download = firstDownload
        eventProperties.language = 'typescript'
        eventProperties.source = this._source
        eventProperties.package = 'inspector'

        await this._scarfClient.logEvent(eventProperties)
      }
    }
    catch (e) {
      logger.debug(`Failed to track Scarf package_download event: ${e}`)
    }
  }

  async trackInspectorOpen(data: { serverUrl?: string, connectionCount?: number }): Promise<void> {
    const event = new MCPInspectorOpenEvent(data)
    await this.capture(event)
  }

  // PostHog specific methods
  identify(userId: string, properties?: Record<string, any>): void {
    if (this._posthogClient) {
      try {
        this._posthogClient.identify(userId, properties)
      }
      catch (e) {
        logger.debug(`Failed to identify user: ${e}`)
      }
    }
  }

  reset(): void {
    if (this._posthogClient) {
      try {
        this._posthogClient.reset()
      }
      catch (e) {
        logger.debug(`Failed to reset PostHog: ${e}`)
      }
    }
  }
}
