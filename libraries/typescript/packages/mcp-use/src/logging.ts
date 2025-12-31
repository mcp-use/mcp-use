export type LogLevel =
  | "error"
  | "warn"
  | "info"
  | "http"
  | "verbose"
  | "debug"
  | "silly";

interface LoggerOptions {
  level?: LogLevel;
  console?: boolean;
  file?: string;
  format?: "minimal" | "detailed" | "emoji";
}

const DEFAULT_LOGGER_NAME = "mcp-use";

function resolveLevel(env: string | undefined): LogLevel {
  const envValue =
    typeof process !== "undefined" && process.env ? env : undefined;

  switch (envValue?.trim()) {
    case "2":
      return "debug";
    case "1":
      return "info";
    default:
      return "info";
  }
}

// Simple console logger - works everywhere (browser, Node.js, edge)
class ConsoleLogger {
  private _level: LogLevel;
  private name: string;
  public format: any; // Winston-compatible format property (no-op)

  constructor(
    name: string = DEFAULT_LOGGER_NAME,
    level: LogLevel = "info",
    format: "minimal" | "detailed" | "emoji" = "minimal"
  ) {
    this.name = name;
    this._level = level;
    this.format = {}; // Winston-compatible format (no-op)
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [
      "error",
      "warn",
      "info",
      "http",
      "verbose",
      "debug",
      "silly",
    ];
    const currentIndex = levels.indexOf(this._level);
    const messageIndex = levels.indexOf(level);
    return messageIndex <= currentIndex;
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const levelUpper = level.toUpperCase();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";

    return `${timestamp} [${this.name}] ${levelUpper}: ${message}${metaStr}`;
  }

  error(message: string, meta?: any): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, meta));
    }
  }

  warn(message: string, meta?: any): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, meta));
    }
  }

  info(message: string, meta?: any): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, meta));
    }
  }

  debug(message: string, meta?: any): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, meta));
    }
  }

  http(message: string, meta?: any): void {
    if (this.shouldLog("http")) {
      console.log(this.formatMessage("http", message, meta));
    }
  }

  verbose(message: string, meta?: any): void {
    if (this.shouldLog("verbose")) {
      console.log(this.formatMessage("verbose", message, meta));
    }
  }

  silly(message: string, meta?: any): void {
    if (this.shouldLog("silly")) {
      console.log(this.formatMessage("silly", message, meta));
    }
  }

  get level(): LogLevel {
    return this._level;
  }

  set level(newLevel: LogLevel) {
    this._level = newLevel;
  }

  // Winston-compatible methods (no-op for compatibility)
  clear(): void {
    // No-op - console doesn't need clearing
  }

  add(_transport: any): void {
    // No-op - console is always available
  }
}

export class Logger {
  private static instances: Record<string, ConsoleLogger> = {};
  private static currentFormat: "minimal" | "detailed" | "emoji" = "minimal";

  public static get(name: string = DEFAULT_LOGGER_NAME): ConsoleLogger {
    if (!this.instances[name]) {
      const debugEnv =
        (typeof process !== "undefined" && process.env?.DEBUG) || undefined;
      this.instances[name] = new ConsoleLogger(
        name,
        resolveLevel(debugEnv),
        this.currentFormat
      );
    }
    return this.instances[name];
  }

  public static async configure(options: LoggerOptions = {}): Promise<void> {
    const { level, format = "minimal" } = options;
    const debugEnv =
      (typeof process !== "undefined" && process.env?.DEBUG) || undefined;
    const resolvedLevel = level ?? resolveLevel(debugEnv);

    this.currentFormat = format;

    // Update all existing loggers
    Object.values(this.instances).forEach((logger) => {
      logger.level = resolvedLevel;
      // Format is stored in Logger class, not individual instances
    });
  }

  public static setDebug(enabled: boolean | 0 | 1 | 2): void {
    let level: LogLevel;
    if (enabled === 2 || enabled === true) level = "debug";
    else if (enabled === 1) level = "info";
    else level = "info";

    Object.values(this.instances).forEach((logger) => {
      logger.level = level;
    });

    // Safely set environment variable
    if (typeof process !== "undefined" && process.env) {
      process.env.DEBUG = enabled
        ? enabled === true
          ? "2"
          : String(enabled)
        : "0";
    }
  }

  public static setFormat(format: "minimal" | "detailed" | "emoji"): void {
    this.currentFormat = format;
    this.configure({ format });
  }
}

// Initialize logger at module load time
Logger.configure();

export const logger = Logger.get();
