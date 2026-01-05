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
  format?: "minimal" | "detailed" | "emoji";
}

const DEFAULT_LOGGER_NAME = "mcp-use";

/**
 * Map an environment-provided debug value to a LogLevel.
 *
 * @param env - The raw environment string to interpret (typically the DEBUG value)
 * @returns `"debug"` if `env` trimmed equals `"2"`, `"info"` if it equals `"1"`, otherwise `"info"`
 */
function resolveLevel(env: string | undefined): LogLevel {
  // Safely access environment variables
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

/**
 * Convert an array of extra log arguments into a single space-delimited string.
 *
 * String values are kept as-is; non-strings are JSON-stringified when possible, falling back to `String()` on failure.
 *
 * @param args - The additional arguments to format for logging
 * @returns The formatted arguments joined by spaces, or an empty string if `args` is empty
 */
function formatArgs(args: any[]): string {
  if (args.length === 0) return "";

  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

// Simple console logger for all environments
class SimpleConsoleLogger {
  private _level: LogLevel;
  private name: string;
  private format: "minimal" | "detailed" | "emoji";

  constructor(
    name: string = DEFAULT_LOGGER_NAME,
    level: LogLevel = "info",
    format: "minimal" | "detailed" | "emoji" = "minimal"
  ) {
    this.name = name;
    this._level = level;
    this.format = format;
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

  private formatMessage(level: LogLevel, message: string, args: any[]): string {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const extraArgs = formatArgs(args);
    const fullMessage = extraArgs ? `${message} ${extraArgs}` : message;

    switch (this.format) {
      case "detailed":
        return `${timestamp} [${this.name}] ${level.toUpperCase()}: ${fullMessage}`;
      case "emoji": {
        const emojiMap: Record<LogLevel, string> = {
          error: "❌",
          warn: "⚠️",
          info: "ℹ️",
          http: "🌐",
          verbose: "📝",
          debug: "🔍",
          silly: "🤪",
        };
        return `${timestamp} [${this.name}] ${emojiMap[level] || ""} ${level.toUpperCase()}: ${fullMessage}`;
      }
      case "minimal":
      default:
        return `${timestamp} [${this.name}] ${level}: ${fullMessage}`;
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, args));
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, args));
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, args));
    }
  }

  http(message: string, ...args: any[]): void {
    if (this.shouldLog("http")) {
      console.log(this.formatMessage("http", message, args));
    }
  }

  verbose(message: string, ...args: any[]): void {
    if (this.shouldLog("verbose")) {
      console.log(this.formatMessage("verbose", message, args));
    }
  }

  silly(message: string, ...args: any[]): void {
    if (this.shouldLog("silly")) {
      console.log(this.formatMessage("silly", message, args));
    }
  }

  get level(): LogLevel {
    return this._level;
  }

  set level(newLevel: LogLevel) {
    this._level = newLevel;
  }

  setFormat(format: "minimal" | "detailed" | "emoji"): void {
    this.format = format;
  }
}

export class Logger {
  private static instances: Record<string, SimpleConsoleLogger> = {};
  private static currentFormat: "minimal" | "detailed" | "emoji" = "minimal";

  public static get(name: string = DEFAULT_LOGGER_NAME): SimpleConsoleLogger {
    if (!this.instances[name]) {
      const debugEnv =
        (typeof process !== "undefined" && process.env?.DEBUG) || undefined;
      this.instances[name] = new SimpleConsoleLogger(
        name,
        resolveLevel(debugEnv),
        this.currentFormat
      );
    }
    return this.instances[name];
  }

  public static configure(options: LoggerOptions = {}): void {
    const { level, format = "minimal" } = options;
    const debugEnv =
      (typeof process !== "undefined" && process.env?.DEBUG) || undefined;
    const resolvedLevel = level ?? resolveLevel(debugEnv);

    this.currentFormat = format;

    // Update all existing loggers
    Object.values(this.instances).forEach((logger) => {
      logger.level = resolvedLevel;
      logger.setFormat(format);
    });
  }

  public static setDebug(enabled: boolean | 0 | 1 | 2): void {
    let level: LogLevel;
    if (enabled === 2 || enabled === true) level = "debug";
    else if (enabled === 1) level = "info";
    else level = "info";

    // Update all loggers
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

export const logger = Logger.get();