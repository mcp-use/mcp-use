export type LogLevel =
  | "silent"
  | "error"
  | "warn"
  | "info"
  | "http"
  | "verbose"
  | "debug"
  | "silly";

type LogFormat = "minimal" | "detailed" | "emoji";

const LEVELS = [
  "silent",
  "error",
  "warn",
  "info",
  "http",
  "verbose",
  "debug",
  "silly",
] as const satisfies readonly LogLevel[];

const EMOJI: Record<LogLevel, string> = {
  silent: "",
  error: "❌",
  warn: "⚠️",
  info: "ℹ️",
  http: "🌐",
  verbose: "📝",
  debug: "🔍",
  silly: "🤪",
};

function envLevel(): LogLevel {
  let raw: string | undefined;
  try {
    raw =
      typeof process !== "undefined"
        ? (process.env?.MCP_USE_LOG_LEVEL ?? process.env?.DEBUG)
        : undefined;
  } catch {
    // Deno may deny env access.
  }
  const v = raw?.trim().toLowerCase();
  if (v === "2") return "debug";
  if (v && (LEVELS as readonly string[]).includes(v)) return v as LogLevel;
  return "info";
}

class SimpleConsoleLogger {
  constructor(
    private name = "mcp-use",
    public level: LogLevel = "info",
    public format: LogFormat = "minimal"
  ) {}

  private write(level: LogLevel, message: string, args: unknown[]): void {
    if (
      this.level === "silent" ||
      LEVELS.indexOf(level) > LEVELS.indexOf(this.level)
    ) {
      return;
    }
    const extra = args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    const full = extra ? `${message} ${extra}` : message;
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    const label = this.format === "minimal" ? level : level.toUpperCase();
    const emoji = this.format === "emoji" ? ` ${EMOJI[level]}` : "";
    const line = `${ts} [${this.name}]${emoji} ${label}: ${full}`;
    const fn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : level === "info"
            ? console.info
            : level === "debug"
              ? console.debug
              : console.log;
    fn(line);
  }

  error = (m: string, ...a: unknown[]) => this.write("error", m, a);
  warn = (m: string, ...a: unknown[]) => this.write("warn", m, a);
  info = (m: string, ...a: unknown[]) => this.write("info", m, a);
  debug = (m: string, ...a: unknown[]) => this.write("debug", m, a);
  http = (m: string, ...a: unknown[]) => this.write("http", m, a);
  verbose = (m: string, ...a: unknown[]) => this.write("verbose", m, a);
  silly = (m: string, ...a: unknown[]) => this.write("silly", m, a);

  setFormat(format: LogFormat): void {
    this.format = format;
  }
}

export class Logger {
  private static instances: Record<string, SimpleConsoleLogger> = {};
  private static currentFormat: LogFormat = "minimal";
  private static currentLevel: LogLevel | undefined;

  static get(name = "mcp-use"): SimpleConsoleLogger {
    return (this.instances[name] ??= new SimpleConsoleLogger(
      name,
      this.currentLevel ?? envLevel(),
      this.currentFormat
    ));
  }

  static configure({
    level = envLevel(),
    format = "minimal",
  }: { level?: LogLevel; format?: LogFormat } = {}): void {
    this.currentLevel = level;
    this.currentFormat = format;
    for (const log of Object.values(this.instances)) {
      log.level = level;
      log.format = format;
    }
  }

  static setDebug(enabled: boolean | 0 | 1 | 2): void {
    const level: LogLevel =
      enabled === 2 || enabled === true ? "debug" : "info";
    this.currentLevel = level;
    for (const log of Object.values(this.instances)) log.level = level;
    try {
      if (typeof process !== "undefined" && process.env) {
        process.env.MCP_USE_LOG_LEVEL = level;
      }
    } catch {
      // optional
    }
  }

  static setFormat(format: LogFormat): void {
    this.configure({ format });
  }
}

export const logger = Logger.get();
