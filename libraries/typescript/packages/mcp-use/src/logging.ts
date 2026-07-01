import { resolveLogLevel } from "./log-level.js";

export type LogLevel =
  | "silent"
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
 * Resolve the Logger's default level from the single `MCP_USE_LOG_LEVEL` env
 * variable. `debug`/`trace` both map to the `"debug"` Logger level; everything
 * else (including unset) maps to `"info"`.
 */
function resolveDefaultLevel(): LogLevel {
  return resolveLogLevel() === "info" ? "info" : "debug";
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
    if (this._level === "silent") return false;

    const levels = [
      "silent",
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
          silent: "",
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
      this.instances[name] = new SimpleConsoleLogger(
        name,
        resolveDefaultLevel(),
        this.currentFormat
      );
    }
    return this.instances[name];
  }

  public static configure(options: LoggerOptions = {}): void {
    const { level, format = "minimal" } = options;
    const resolvedLevel = level ?? resolveDefaultLevel();

    this.currentFormat = format;

    // Update all existing loggers
    Object.values(this.instances).forEach((logger) => {
      logger.level = resolvedLevel;
      logger.setFormat(format);
    });
  }

  public static setDebug(enabled: boolean | 0 | 1 | 2): void {
    const level: LogLevel =
      enabled === 2 || enabled === true ? "debug" : "info";

    // Update all loggers in-process. This intentionally does NOT mutate
    // `process.env` — a library must not write global environment state
    // (that footgun leaked verbosity into unrelated child processes).
    Object.values(this.instances).forEach((logger) => {
      logger.level = level;
    });
  }

  public static setFormat(format: "minimal" | "detailed" | "emoji"): void {
    this.currentFormat = format;
    this.configure({ format });
  }
}

export const logger = Logger.get();
