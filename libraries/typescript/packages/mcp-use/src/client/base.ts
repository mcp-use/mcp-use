import type { BaseConnector } from "../connectors/base.js";
import { logger } from "../logging.js";
import { MCPSession } from "../session.js";
import { Tel } from "../telemetry/index.js";

/**
 * Base MCPClient class with shared functionality across all environments.
 *
 * This abstract class provides the core client logic for managing MCP servers,
 * sessions, and configurations. It works in both Node.js and browser environments
 * by delegating platform-specific operations to concrete implementations.
 *
 * Platform-specific implementations (like {@link MCPClient} for Node.js) should
 * extend this class and override the abstract {@link createConnectorFromConfig}
 * method to provide environment-specific connector creation.
 *
 * @example
 * ```typescript
 * // Typically used through concrete implementations
 * import { MCPClient } from 'mcp-use/client';
 *
 * const client = new MCPClient({
 *   mcpServers: {
 *     'my-server': {
 *       command: 'node',
 *       args: ['server.js']
 *     }
 *   }
 * });
 * ```
 *
 * @see {@link MCPClient} for Node.js-specific implementation
 * @see {@link MCPSession} for session management
 */
export abstract class BaseMCPClient {
  /**
   * Internal configuration object containing MCP server definitions.
   * @protected
   */
  protected config: Record<string, any> = {};

  /**
   * Map of server names to their active sessions.
   * @protected
   */
  protected sessions: Record<string, MCPSession> = {};

  /**
   * List of server names that have active sessions.
   * This array is kept in sync with the sessions map and can be used
   * to iterate over active connections.
   *
   * @example
   * ```typescript
   * console.log(`Active servers: ${client.activeSessions.join(', ')}`);
   * ```
   */
  public activeSessions: string[] = [];

  /**
   * Creates a new BaseMCPClient instance.
   *
   * @param config - Optional configuration object with MCP server definitions
   *
   * @example
   * ```typescript
   * const client = new MCPClient({
   *   mcpServers: {
   *     'example': {
   *       command: 'node',
   *       args: ['server.js']
   *     }
   *   }
   * });
   * ```
   */
  constructor(config?: Record<string, any>) {
    if (config) {
      this.config = config;
    }
  }

  /**
   * Creates a client instance from a configuration dictionary.
   *
   * This static factory method must be implemented by concrete subclasses
   * to provide proper type information and platform-specific initialization.
   *
   * @param _cfg - Configuration dictionary
   * @returns Client instance
   * @throws {Error} If called on the base class instead of a concrete implementation
   *
   * @example
   * ```typescript
   * const client = MCPClient.fromDict({
   *   mcpServers: {
   *     'my-server': { command: 'node', args: ['server.js'] }
   *   }
   * });
   * ```
   */
  public static fromDict(_cfg: Record<string, any>): BaseMCPClient {
    // This will be overridden by concrete implementations
    throw new Error("fromDict must be implemented by concrete class");
  }

  /**
   * Adds a new MCP server configuration to the client.
   *
   * This method adds or updates a server configuration dynamically without
   * needing to restart the client. The server can then be used to create
   * new sessions.
   *
   * @param name - Unique name for the server
   * @param serverConfig - Server configuration object (connector type, command, args, etc.)
   *
   * @example
   * ```typescript
   * client.addServer('new-server', {
   *   command: 'python',
   *   args: ['server.py']
   * });
   *
   * // Now you can create a session
   * const session = await client.createSession('new-server');
   * ```
   *
   * @see {@link removeServer} for removing servers
   * @see {@link getServerConfig} for retrieving configurations
   */
  public addServer(name: string, serverConfig: Record<string, any>): void {
    this.config.mcpServers = this.config.mcpServers || {};
    this.config.mcpServers[name] = serverConfig;
    Tel.getInstance().trackClientAddServer(name, serverConfig);
  }

  /**
   * Removes an MCP server configuration from the client.
   *
   * This method removes a server configuration and cleans up any active
   * sessions associated with that server. If there's an active session,
   * it will be removed from the active sessions list.
   *
   * @param name - Name of the server to remove
   *
   * @example
   * ```typescript
   * // Remove a server configuration
   * client.removeServer('old-server');
   *
   * // The server name will no longer appear in getServerNames()
   * console.log(client.getServerNames()); // 'old-server' is gone
   * ```
   *
   * @see {@link addServer} for adding servers
   * @see {@link closeSession} for properly closing sessions before removal
   */
  public removeServer(name: string): void {
    if (this.config.mcpServers?.[name]) {
      delete this.config.mcpServers[name];
      this.activeSessions = this.activeSessions.filter((n) => n !== name);
      Tel.getInstance().trackClientRemoveServer(name);
    }
  }

  /**
   * Gets the names of all configured MCP servers.
   *
   * @returns Array of server names defined in the configuration
   *
   * @example
   * ```typescript
   * const serverNames = client.getServerNames();
   * console.log(`Configured servers: ${serverNames.join(', ')}`);
   *
   * // Create sessions for all servers
   * for (const name of serverNames) {
   *   await client.createSession(name);
   * }
   * ```
   *
   * @see {@link activeSessions} for servers with active sessions
   */
  public getServerNames(): string[] {
    return Object.keys(this.config.mcpServers ?? {});
  }

  /**
   * Gets the configuration for a specific MCP server.
   *
   * @param name - Name of the server
   * @returns Server configuration object, or undefined if not found
   *
   * @example
   * ```typescript
   * const config = client.getServerConfig('my-server');
   * if (config) {
   *   console.log(`Command: ${config.command}`);
   *   console.log(`Args: ${config.args.join(' ')}`);
   * }
   * ```
   *
   * @see {@link getConfig} for retrieving the entire configuration
   */
  public getServerConfig(name: string): Record<string, any> {
    return this.config.mcpServers?.[name];
  }

  /**
   * Gets the complete client configuration.
   *
   * @returns Complete configuration object including all server definitions
   *
   * @example
   * ```typescript
   * const config = client.getConfig();
   * console.log(`Total servers: ${Object.keys(config.mcpServers).length}`);
   * ```
   *
   * @see {@link getServerConfig} for retrieving individual server configurations
   */
  public getConfig(): Record<string, any> {
    return this.config ?? {};
  }

  /**
   * Creates a connector from server configuration.
   *
   * This abstract method must be implemented by platform-specific subclasses
   * to create the appropriate connector type (Stdio, HTTP, WebSocket, etc.)
   * based on the server configuration and runtime environment.
   *
   * @param serverConfig - Server configuration object
   * @returns Platform-specific connector instance
   * @protected
   */
  protected abstract createConnectorFromConfig(
    serverConfig: Record<string, any>
  ): BaseConnector;

  /**
   * Creates a new session for connecting to an MCP server.
   *
   * This method initializes a connection to the specified server using the
   * configuration provided during client construction. Sessions manage the
   * lifecycle of connections and provide methods for calling tools, listing
   * resources, and more.
   *
   * If a session already exists for the server, it will be replaced with a new one.
   *
   * @param serverName - The name of the server as defined in the client configuration
   * @param autoInitialize - Whether to automatically initialize the session (default: true)
   * @returns A promise that resolves to the created MCPSession instance
   * @throws {Error} If the server is not found in the configuration
   *
   * @example
   * ```typescript
   * // Create and initialize a session
   * const session = await client.createSession('my-server');
   * const tools = await session.listTools();
   *
   * // Create without auto-initialization
   * const session = await client.createSession('my-server', false);
   * await session.connect();
   * await session.initialize();
   * ```
   *
   * @see {@link MCPSession} for session management methods
   * @see {@link closeSession} for closing sessions
   * @see {@link getSession} for retrieving existing sessions
   */
  public async createSession(
    serverName: string,
    autoInitialize = true
  ): Promise<MCPSession> {
    const servers = this.config.mcpServers ?? {};

    if (Object.keys(servers).length === 0) {
      logger.warn("No MCP servers defined in config");
    }

    if (!servers[serverName]) {
      throw new Error(`Server '${serverName}' not found in config`);
    }

    const connector = this.createConnectorFromConfig(servers[serverName]);
    const session = new MCPSession(connector);

    if (autoInitialize) {
      await session.initialize();
    }

    this.sessions[serverName] = session;
    if (!this.activeSessions.includes(serverName)) {
      this.activeSessions.push(serverName);
    }
    return session;
  }

  /**
   * Creates sessions for all configured MCP servers.
   *
   * This is a convenience method that iterates through all servers in the
   * configuration and creates a session for each one. Sessions are created
   * sequentially to avoid overwhelming the system.
   *
   * @param autoInitialize - Whether to automatically initialize each session (default: true)
   * @returns A promise that resolves to a map of server names to sessions
   *
   * @example
   * ```typescript
   * // Create sessions for all configured servers
   * const sessions = await client.createAllSessions();
   * console.log(`Created ${Object.keys(sessions).length} sessions`);
   *
   * // List tools from all servers
   * for (const [name, session] of Object.entries(sessions)) {
   *   const tools = await session.listTools();
   *   console.log(`${name}: ${tools.length} tools`);
   * }
   * ```
   *
   * @see {@link createSession} for creating individual sessions
   * @see {@link closeAllSessions} for closing all sessions
   */
  public async createAllSessions(
    autoInitialize = true
  ): Promise<Record<string, MCPSession>> {
    const servers = this.config.mcpServers ?? {};

    if (Object.keys(servers).length === 0) {
      logger.warn("No MCP servers defined in config");
    }

    for (const name of Object.keys(servers)) {
      await this.createSession(name, autoInitialize);
    }

    return this.sessions;
  }

  /**
   * Retrieves an existing session by server name.
   *
   * This method returns null if no session exists, making it safe for
   * checking session existence without throwing errors.
   *
   * @param serverName - Name of the server
   * @returns The session instance or null if not found
   *
   * @example
   * ```typescript
   * const session = client.getSession('my-server');
   * if (session) {
   *   const tools = await session.listTools();
   * } else {
   *   console.log('Session not found, creating...');
   *   await client.createSession('my-server');
   * }
   * ```
   *
   * @see {@link requireSession} for getting a session that throws if not found
   * @see {@link createSession} for creating sessions
   */
  public getSession(serverName: string): MCPSession | null {
    const session = this.sessions[serverName];
    if (!session) {
      return null;
    }
    return session;
  }

  /**
   * Retrieves an existing session by server name, throwing if not found.
   *
   * This method is useful when you need to ensure a session exists before
   * proceeding. It throws a descriptive error if the session is not found.
   *
   * @param serverName - Name of the server
   * @returns The session instance
   * @throws {Error} If the session is not found
   *
   * @example
   * ```typescript
   * try {
   *   const session = client.requireSession('my-server');
   *   const tools = await session.listTools();
   * } catch (error) {
   *   console.error('Session not found:', error.message);
   * }
   * ```
   *
   * @see {@link getSession} for a null-returning alternative
   * @see {@link createSession} for creating sessions
   */
  public requireSession(serverName: string): MCPSession {
    const session = this.sessions[serverName];
    if (!session) {
      throw new Error(
        `Session '${serverName}' not found. Available sessions: ${this.activeSessions.join(", ") || "none"}`
      );
    }
    return session;
  }

  /**
   * Gets all active sessions as a map of server names to sessions.
   *
   * @returns Map of server names to their active sessions
   *
   * @example
   * ```typescript
   * const sessions = client.getAllActiveSessions();
   *
   * // Iterate over all active sessions
   * for (const [name, session] of Object.entries(sessions)) {
   *   console.log(`Server: ${name}`);
   *   const tools = await session.listTools();
   *   console.log(`  Tools: ${tools.length}`);
   * }
   * ```
   *
   * @see {@link activeSessions} for just the list of server names
   * @see {@link getSession} for retrieving individual sessions
   */
  public getAllActiveSessions(): Record<string, MCPSession> {
    return Object.fromEntries(
      this.activeSessions.map((n) => [n, this.sessions[n]])
    );
  }

  /**
   * Closes a session and cleans up its resources.
   *
   * This method gracefully disconnects from the server and removes the
   * session from the active sessions list. It's safe to call even if
   * the session doesn't exist.
   *
   * @param serverName - Name of the server whose session should be closed
   *
   * @example
   * ```typescript
   * // Close a specific session
   * await client.closeSession('my-server');
   *
   * // Verify it's closed
   * console.log(client.activeSessions.includes('my-server')); // false
   * ```
   *
   * @see {@link closeAllSessions} for closing all sessions at once
   * @see {@link createSession} for creating new sessions
   */
  public async closeSession(serverName: string): Promise<void> {
    const session = this.sessions[serverName];
    if (!session) {
      logger.warn(
        `No session exists for server ${serverName}, nothing to close`
      );
      return;
    }
    try {
      logger.debug(`Closing session for server ${serverName}`);
      await session.disconnect();
    } catch (e) {
      logger.error(`Error closing session for server '${serverName}': ${e}`);
    } finally {
      delete this.sessions[serverName];
      this.activeSessions = this.activeSessions.filter((n) => n !== serverName);
    }
  }

  /**
   * Closes all active sessions and cleans up their resources.
   *
   * This method iterates through all sessions and attempts to close each one
   * gracefully. If any session fails to close, the error is logged but the
   * method continues to close remaining sessions.
   *
   * This is particularly useful for cleanup on application shutdown.
   *
   * @example
   * ```typescript
   * // Clean shutdown
   * try {
   *   await client.closeAllSessions();
   *   console.log('All sessions closed successfully');
   * } catch (error) {
   *   console.error('Error during cleanup:', error);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Use in application shutdown handler
   * process.on('SIGINT', async () => {
   *   console.log('Shutting down...');
   *   await client.closeAllSessions();
   *   process.exit(0);
   * });
   * ```
   *
   * @see {@link closeSession} for closing individual sessions
   * @see {@link createAllSessions} for creating sessions
   */
  public async closeAllSessions(): Promise<void> {
    const serverNames = Object.keys(this.sessions);
    const errors: string[] = [];
    for (const serverName of serverNames) {
      try {
        logger.debug(`Closing session for server ${serverName}`);
        await this.closeSession(serverName);
      } catch (e: any) {
        const errorMsg = `Failed to close session for server '${serverName}': ${e}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }
    if (errors.length) {
      logger.error(
        `Encountered ${errors.length} errors while closing sessions`
      );
    } else {
      logger.debug("All sessions closed successfully");
    }
  }
}
