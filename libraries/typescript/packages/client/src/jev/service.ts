/** Configuration shared by Jev routing and the tool-result firewall (Node.js only). */
export interface JevOptions {
  /** Defaults to TYPESAFE_API_KEY. */
  apiKey?: string;
  /** TypeSafe API origin, or an explicitly trusted proxy. */
  baseUrl?: string;
  /** Defaults to jev-latest. */
  model?: string;
  /** Per-request timeout, including reading the response. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Maximum serialized request size. Oversized input is rejected, never truncated. */
  maxRequestBytes?: number;
  /** Optional fetch implementation for a trusted proxy or testing. */
  fetch?: typeof globalThis.fetch;
}

export class JevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevError";
  }
}

export function isProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function probabilityOption(value: number, name: string): number {
  if (!isProbability(value))
    throw new JevError(`${name} must be between 0 and 1`);
  return value;
}

export type JevQuestion = {
  type: "choice" | "noul";
  instructions: string;
  criteria?: Record<string, unknown>;
};

/** Small HTTP adapter for https://docs.typesafe.ai/api. Does not log state or credentials. */
export class JevService {
  readonly #apiKey: string;
  readonly #url: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #maxRequestBytes: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: JevOptions = {}) {
    this.#apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? "";
    if (!this.#apiKey.trim())
      throw new JevError("Jev requires apiKey or TYPESAFE_API_KEY");
    const url = new URL(options.baseUrl ?? "https://api.typesafe.ai");
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    ) {
      throw new JevError("Jev baseUrl must use HTTPS (or localhost HTTP)");
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new JevError(
        "Jev baseUrl must not contain credentials, query parameters, or a fragment"
      );
    }
    this.#url = `${url.href.replace(/\/$/, "")}/v1/systemone`;
    this.#model = options.model ?? "jev-latest";
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#maxRequestBytes = options.maxRequestBytes ?? 128 * 1024;
    for (const [name, value] of [
      ["timeoutMs", this.#timeoutMs],
      ["maxRequestBytes", this.#maxRequestBytes],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
        throw new JevError(`${name} must be a positive 32-bit integer`);
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async ask(
    state: unknown,
    question: JevQuestion,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    let body: string;
    try {
      body = JSON.stringify({
        state,
        model: this.#model,
        questions: { decision: question },
      });
    } catch {
      throw new JevError("Jev input is not JSON serializable");
    }
    if (Buffer.byteLength(body, "utf8") > this.#maxRequestBytes)
      throw new JevError("Jev request exceeds maxRequestBytes");
    const controller = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      combinedSignal.throwIfAborted();
      const response = await this.#fetch(this.#url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: combinedSignal,
        redirect: "error",
      });
      if (!response.ok)
        throw new JevError(`Jev request failed (HTTP ${response.status})`);
      const data = await response.json();
      const answer = data?.answers?.decision;
      if (!answer || typeof answer !== "object" || Array.isArray(answer))
        throw new JevError("Invalid Jev response");
      return answer;
    } catch (error) {
      if (error instanceof JevError) throw error;
      // Provider bodies and network errors can contain tool content or credentials.
      throw new JevError(
        combinedSignal.aborted
          ? "Jev request aborted or timed out"
          : "Jev request failed"
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
