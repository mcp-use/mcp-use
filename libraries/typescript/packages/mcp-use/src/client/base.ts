import type { BaseConnector } from "../connectors/base.js";
import { logger } from "../logging.js";
import { MCPSession } from "../session.js";
import { Tel } from "../telemetry/index.js";

/**
 * Base MCPClient class with shared functionality
 *
 * This class contains all the common logic that works in both Node.js and browser environments.
 * Platform-specific implementations should extend this class and override methods as needed.
 */
export abstract class BaseMCPClient {
  protected config: Record<string, any> = {};
  protected sessions: Record<string, MCPSession> = {};
  public activeSessions: string[] = [];

  constructor(config?: Record<string, any>) {
    if (config) {
      this.config = config;
    }
  }

  public static fromDict(_cfg: Record<string, any>): BaseMCPClient {
    // This will be overridden by concrete implementations
    throw new Error("fromDict must be implemented by concrete class");
  }

  public addServer(name: string, serverConfig: Record<string, any>): void {
    this.config.mcpServers = this.config.mcpServers || {};
    this.config.mcpServers[name] = serverConfig;
    Tel.getInstance().trackClientAddServer(name, serverConfig);
  }

  public removeServer(name: string): void {
    if (this.config.mcpServers?.[name]) {
      delete this.config.mcpServers[name];
      this.activeSessions = this.activeSessions.filter((n) => n !== name);
      Tel.getInstance().trackClientRemoveServer(name);
    }
  }

  public getServerNames(): string[] {
    return Object.keys(this.config.mcpServers ?? {});
  }

  public getServerConfig(name: string): Record<string, any> {
    return this.config.mcpServers?.[name];
  }

  public getConfig(): Record<string, any> {
    return this.config ?? {};
  }

  /**
   * Create a connector from server configuration
   * This method must be implemented by platform-specific subclasses
   */
  protected abstract createConnectorFromConfig(
    serverConfig: Record<string, any>
  ): BaseConnector;

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

  public getSession(serverName: string): MCPSession | null {
    const session = this.sessions[serverName];
    if (!session) {
      return null;
    }
    return session;
  }

  public getAllActiveSessions(): Record<string, MCPSession> {
    return Object.fromEntries(
      this.activeSessions.map((n) => [n, this.sessions[n]])
    );
  }

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
