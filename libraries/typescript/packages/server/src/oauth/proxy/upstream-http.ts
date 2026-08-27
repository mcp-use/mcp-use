import { isRecord } from "../guards.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TIMER_MS = 2_147_483_647;

/** @internal Normalized, secret-safe failure from an upstream OAuth operation. */
export class UpstreamOAuthError extends Error {
  /** Stable OAuth or client-side error code. */
  readonly code: string;
  /** Upstream HTTP status, when a response was received. */
  readonly status?: number;
  /** Sanitized upstream error description, when one was returned. */
  readonly description?: string;

  /** Creates a normalized upstream OAuth failure. */
  constructor(
    code: string,
    message: string,
    options: { status?: number; description?: string } = {}
  ) {
    super(message);
    this.name = "UpstreamOAuthError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.description !== undefined)
      this.description = options.description;
  }
}

/** @internal Options for the hardened upstream form-POST boundary. */
export interface UpstreamHttpOptions {
  /** Fetch implementation used for upstream requests. */
  fetch?: typeof fetch;
  /** Total timeout covering response headers and response-body streaming. */
  timeoutMs?: number;
  /** Maximum number of response-body bytes read from an upstream endpoint. */
  maxResponseBytes?: number;
}

/** @internal Inputs for one bounded upstream form POST. */
export interface UpstreamFormPost {
  /** Fixed endpoint selected by the proxy adapter. */
  endpoint: URL;
  /** Form request parameters. */
  params: URLSearchParams;
  /** Request headers, including any client authentication. */
  headers?: Headers;
  /** Safe operation label used in normalized errors. */
  operation: string;
  /** Values that must be removed from upstream error descriptions. */
  sensitiveValues: readonly (string | undefined)[];
  /** Whether a successful empty body is accepted. */
  allowEmptySuccess?: boolean;
  /** Optional caller cancellation signal. */
  signal?: AbortSignal;
}

/** @internal Runtime-neutral, bounded form-POST transport for OAuth endpoints. */
export class UpstreamOAuthHttpClient {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  /** Validates and stores immutable transport limits. */
  constructor(options: UpstreamHttpOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function")
      throw new TypeError("fetch must be available");
    this.#timeoutMs = timerDuration(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs"
    );
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes"
    );
  }

  /** Executes one manual-redirect, bounded, cancellable form POST. */
  async postForm(request: UpstreamFormPost): Promise<Record<string, unknown>> {
    const headers = new Headers(request.headers);
    headers.set(
      "accept",
      "application/json, application/x-www-form-urlencoded"
    );
    headers.set(
      "content-type",
      "application/x-www-form-urlencoded;charset=UTF-8"
    );
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) abortFromCaller();
    else
      request.signal?.addEventListener("abort", abortFromCaller, {
        once: true,
      });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    let response: Response;
    let text: string;
    try {
      response = await raceWithAbort(
        this.#fetch(request.endpoint, {
          method: "POST",
          headers,
          body: request.params,
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
        }),
        controller.signal
      );
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      ) {
        cancelResponseBody(response);
        throw oauthFailure(
          "redirect_not_allowed",
          `Upstream OAuth ${request.operation} returned a redirect`,
          response.status
        );
      }
      text = await readBoundedText(
        response,
        this.#maxResponseBytes,
        controller.signal
      );
    } catch (error) {
      if (error instanceof UpstreamOAuthError) throw error;
      if (timedOut) {
        throw oauthFailure(
          "timeout",
          `Upstream OAuth ${request.operation} timed out`
        );
      }
      if (request.signal?.aborted) {
        throw oauthFailure(
          "aborted",
          `Upstream OAuth ${request.operation} was cancelled`
        );
      }
      throw oauthFailure(
        "network_error",
        `Upstream OAuth ${request.operation} request failed`
      );
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }

    let parsed: Record<string, unknown> | undefined;
    if (text.length > 0) {
      try {
        parsed = parseOAuthBody(text, response.headers.get("content-type"));
      } catch (error) {
        if (
          !response.ok &&
          error instanceof UpstreamOAuthError &&
          error.code === "malformed_response"
        ) {
          throw oauthFailure(
            "upstream_http_error",
            `Upstream OAuth ${request.operation} failed`,
            response.status
          );
        }
        throw error;
      }
      if (typeof parsed.error === "string") {
        throw providerOAuthError(
          request.operation,
          parsed.error,
          typeof parsed.error_description === "string"
            ? parsed.error_description
            : undefined,
          response.status,
          request.sensitiveValues
        );
      }
    }
    if (!response.ok) {
      throw oauthFailure(
        "upstream_http_error",
        `Upstream OAuth ${request.operation} failed`,
        response.status
      );
    }
    if (parsed === undefined) {
      if (request.allowEmptySuccess) return {};
      throw oauthFailure(
        "malformed_response",
        `Upstream OAuth ${request.operation} returned an empty response`,
        response.status
      );
    }
    return parsed;
  }
}

/** @internal Creates a normalized upstream OAuth failure. */
export function oauthFailure(
  code: string,
  message: string,
  status?: number,
  description?: string
): UpstreamOAuthError {
  return new UpstreamOAuthError(code, message, {
    ...(status === undefined ? {} : { status }),
    ...(description === undefined ? {} : { description }),
  });
}

/** @internal Returns RFC 6749 form encoding for one credential component. */
export function formEncode(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

/** @internal Encodes a UTF-8 string as portable Base64. */
export function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function timerDuration(value: number, name: string): number {
  const duration = positiveInteger(value, name);
  if (duration > MAX_TIMER_MS) {
    throw new TypeError(`${name} must not exceed ${MAX_TIMER_MS}`);
  }
  return duration;
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function cancelResponseBody(response: Response): void {
  const cancellation = response.body?.cancel();
  if (cancellation !== undefined) void cancellation.catch(() => undefined);
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > maximumBytes
  ) {
    cancelResponseBody(response);
    throw oauthFailure(
      "response_too_large",
      "Upstream OAuth response exceeded the configured size limit",
      response.status
    );
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await raceWithAbort(reader.read(), signal);
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        void reader.cancel().catch(() => undefined);
        throw oauthFailure(
          "response_too_large",
          "Upstream OAuth response exceeded the configured size limit",
          response.status
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    throw oauthFailure(
      "malformed_response",
      "Upstream OAuth endpoint returned invalid UTF-8",
      response.status
    );
  }
}

function parseOAuthBody(
  text: string,
  contentType: string | null
): Record<string, unknown> {
  if (contentType?.toLowerCase().includes("json") || text.startsWith("{")) {
    try {
      const value: unknown = JSON.parse(text);
      if (!isRecord(value)) throw new TypeError();
      return value;
    } catch {
      throw oauthFailure(
        "malformed_response",
        "Upstream OAuth endpoint returned malformed JSON"
      );
    }
  }
  if (!text.includes("=") || /%(?![0-9A-Fa-f]{2})/.test(text)) {
    throw oauthFailure(
      "malformed_response",
      "Upstream OAuth endpoint returned malformed form encoding"
    );
  }
  const params = new URLSearchParams(text);
  const fields = [...params.keys()];
  if (new Set(fields).size !== fields.length) {
    throw oauthFailure(
      "malformed_response",
      "Upstream OAuth endpoint returned duplicate response fields"
    );
  }
  return Object.fromEntries(params);
}

/** @internal Normalizes and redacts an upstream OAuth error response. */
export function providerOAuthError(
  operation: string,
  providerCode: string,
  description: string | undefined,
  status: number | undefined,
  sensitiveValues: readonly (string | undefined)[]
): UpstreamOAuthError {
  const redactedCode = redact(providerCode, sensitiveValues);
  const safeCode =
    redactedCode === providerCode &&
    /^[A-Za-z0-9._~-]{1,128}$/.test(providerCode)
      ? providerCode
      : "upstream_oauth_error";
  const safeDescription =
    description === undefined
      ? undefined
      : redact(description, sensitiveValues).slice(0, 1024);
  return oauthFailure(
    safeCode,
    `Upstream OAuth ${operation} failed (${safeCode})`,
    status,
    safeDescription
  );
}

function redact(
  value: string,
  sensitiveValues: readonly (string | undefined)[]
): string {
  let result = value;
  for (const sensitive of sensitiveValues) {
    if (sensitive === undefined || sensitive.length === 0) continue;
    for (const variant of new Set([
      sensitive,
      encodeURIComponent(sensitive),
      formEncode(sensitive),
      base64Utf8(sensitive),
    ])) {
      result = result.replaceAll(variant, "[REDACTED]");
    }
  }
  return result;
}
