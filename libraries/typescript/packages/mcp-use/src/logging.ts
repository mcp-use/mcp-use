import type { Logger as WinstonLogger } from "winston";

// Conditional imports for Node.js-only modules
async function getNodeModules() {
  if (typeof process !== "undefined" && process.platform) {
    try {
      // Use dynamic imports for Node.js environments
      const fs = await import("node:fs");
      const path = await import("node:path");
      return { fs: fs.default, path: path.default };
    } catch {
      return { fs: null, path: null };
    }
  }
  return { fs: null, path: null };
}

// Lazy-load winston only in Node.js environments
let winston: typeof import("winston") | null = null;
async function getWinston() {
  if (!winston) {
    winston = await import("winston");
  }
  return winston;
}

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

// Environment detection function (similar to telemetry)
function isNodeJSEnvironment(): boolean {
  try {
    // Check for Cloudflare Workers specifically
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent?.includes("Cloudflare-Workers")
    ) {
      return false;
    }

    // Check for other edge runtime indicators
    if (
      typeof (globalThis as any).EdgeRuntime !== "undefined" ||
      typeof (globalThis as any).Deno !== "undefined"
    ) {
      return false;
    }

    // Check for Node.js specific globals that are not available in edge environments
    const hasNodeGlobals =
      typeof process !== "undefined" &&
      typeof process.platform !== "undefined" &&
      typeof __dirname !== "undefined";

    return hasNodeGlobals;
  } catch {
    return false;
  }
}

// Simple console logger for non-Node.js environments
class SimpleConsoleLogger {
  private _level: LogLevel;
  private name: string;

  constructor(name: string = DEFAULT_LOGGER_NAME, level: LogLevel = "info") {
    this.name = name;
    this._level = level;
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

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    return `${timestamp} [${this.name}] ${level}: ${message}`;
  }

  error(message: string): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message));
    }
  }

  warn(message: string): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message));
    }
  }

  info(message: string): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message));
    }
  }

  debug(message: string): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message));
    }
  }

  http(message: string): void {
    if (this.shouldLog("http")) {
      console.log(this.formatMessage("http", message));
    }
  }

  verbose(message: string): void {
    if (this.shouldLog("verbose")) {
      console.log(this.formatMessage("verbose", message));
    }
  }

  silly(message: string): void {
    if (this.shouldLog("silly")) {
      console.log(this.formatMessage("silly", message));
    }
  }

  // Make it compatible with Winston interface
  get level(): LogLevel {
    return this._level;
  }

  set level(newLevel: LogLevel) {
    this._level = newLevel;
  }
}

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

export class Logger {
  private static instances: Record<
    string,
    WinstonLogger | SimpleConsoleLogger
  > = {};
  private static simpleInstances: Record<string, SimpleConsoleLogger> = {};
  private static currentFormat: "minimal" | "detailed" | "emoji" = "minimal";

  public static get(
    name: string = DEFAULT_LOGGER_NAME
  ): WinstonLogger | SimpleConsoleLogger {
    // Use simple console logger in non-Node.js environments
    if (!isNodeJSEnvironment()) {
      if (!this.simpleInstances[name]) {
        const debugEnv =
          (typeof process !== "undefined" && process.env?.DEBUG) || undefined;
        this.simpleInstances[name] = new SimpleConsoleLogger(
          name,
          resolveLevel(debugEnv)
        );
      }
      return this.simpleInstances[name];
    }

    // Use Winston logger in Node.js environments
    if (!this.instances[name]) {
      if (!winston) {
        throw new Error("Winston not loaded - call Logger.configure() first");
      }
      const { createLogger, format } = winston;
      const { combine, timestamp, label, colorize, splat } = format;

      this.instances[name] = createLogger({
        level: resolveLevel(process.env.DEBUG),
        format: combine(
          colorize(),
          splat(),
          label({ label: name }),
          timestamp({ format: "HH:mm:ss" }),
          this.getFormatter()
        ),
        transports: [],
      });
    }

    return this.instances[name];
  }

  private static getFormatter() {
    if (!winston) {
      throw new Error("Winston not loaded");
    }
    const { format } = winston;
    const { printf } = format;

    const minimalFormatter = printf(({ level, message, label, timestamp }) => {
      return `${timestamp} [${label}] ${level}: ${message}`;
    });

    const detailedFormatter = printf(({ level, message, label, timestamp }) => {
      return `${timestamp} [${label}] ${level.toUpperCase()}: ${message}`;
    });

    const emojiFormatter = printf(({ level, message, label, timestamp }) => {
      return `${timestamp} [${label}] ${level.toUpperCase()}: ${message}`;
    });

    switch (this.currentFormat) {
      case "minimal":
        return minimalFormatter;
      case "detailed":
        return detailedFormatter;
      case "emoji":
        return emojiFormatter;
      default:
        return minimalFormatter;
    }
  }

  public static async configure(options: LoggerOptions = {}): Promise<void> {
    const { level, console = true, file, format = "minimal" } = options;
    const debugEnv =
      (typeof process !== "undefined" && process.env?.DEBUG) || undefined;
    const resolvedLevel = level ?? resolveLevel(debugEnv);

    this.currentFormat = format;

    // For non-Node.js environments, just update the level
    if (!isNodeJSEnvironment()) {
      Object.values(this.simpleInstances).forEach((logger) => {
        logger.level = resolvedLevel;
      });

      return;
    }

    // Load winston for Node.js environments
    await getWinston();
    if (!winston) {
      throw new Error("Failed to load winston");
    }

    const root = this.get();

    root.level = resolvedLevel;

    // Winston-specific configuration for Node.js environments
    const winstonRoot = root as WinstonLogger;
    winstonRoot.clear();

    if (console) {
      winstonRoot.add(new winston.transports.Console());
    }

    if (file) {
      const { fs: nodeFs, path: nodePath } = await getNodeModules();
      if (nodeFs && nodePath) {
        const dir = nodePath.dirname(nodePath.resolve(file));
        if (!nodeFs.existsSync(dir)) {
          nodeFs.mkdirSync(dir, { recursive: true });
        }
        winstonRoot.add(new winston.transports.File({ filename: file }));
      }
    }

    // Update all existing Winston loggers with new format
    const { format: winstonFormat } = winston;
    const { combine, timestamp, label, colorize, splat } = winstonFormat;

    Object.values(this.instances).forEach((logger) => {
      if (logger && "format" in logger) {
        logger.level = resolvedLevel;
        (logger as WinstonLogger).format = combine(
          colorize(),
          splat(),
          label({ label: DEFAULT_LOGGER_NAME }),
          timestamp({ format: "HH:mm:ss" }),
          this.getFormatter()
        );
      }
    });
  }

  public static setDebug(enabled: boolean | 0 | 1 | 2): void {
    let level: LogLevel;
    if (enabled === 2 || enabled === true) level = "debug";
    else if (enabled === 1) level = "info";
    else level = "info";

    // Update both simple and Winston loggers
    Object.values(this.simpleInstances).forEach((logger) => {
      logger.level = level;
    });

    Object.values(this.instances).forEach((logger) => {
      if (logger) {
        logger.level = level;
      }
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

// Only configure Winston features if in Node.js environment
(async () => {
  if (isNodeJSEnvironment()) {
    await Logger.configure();
  } else {
    // For non-Node.js environments, just initialize with defaults
    await Logger.configure({ console: true });
  }
})();

export const logger = Logger.get();
