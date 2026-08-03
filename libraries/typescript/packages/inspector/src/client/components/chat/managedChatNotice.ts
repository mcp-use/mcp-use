import type { LLMConfig } from "./types";

export type ManagedChatNotice =
  | { kind: "cloud_unavailable" }
  | { kind: "login_required"; loginUrl: string }
  | {
      kind: "credits_exhausted";
      billingUrl?: string;
      message?: string;
    };

export function isManagedLlmConfig(llmConfig: LLMConfig | null): boolean {
  if (!llmConfig) return false;
  return (
    llmConfig.apiKey === "server-managed" ||
    llmConfig.baseUrl?.includes("/inspector/llm") === true
  );
}

export function isCloudFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed")
  );
}

function noticeFromErrorBody(
  status: number,
  body: Record<string, unknown> | null | undefined
): ManagedChatNotice | null {
  if (!body) {
    if (status >= 502 && status <= 504) return { kind: "cloud_unavailable" };
    return null;
  }

  if (status === 402) {
    return {
      kind: "credits_exhausted",
      billingUrl:
        typeof body.upgradeUrl === "string"
          ? body.upgradeUrl
          : typeof body.billingUrl === "string"
            ? body.billingUrl
            : undefined,
      message:
        typeof body.message === "string"
          ? body.message
          : "You've used your included free plan credits.",
    };
  }

  if (status === 429) {
    if (body.loginRequired && body.loginUrl) {
      return { kind: "login_required", loginUrl: String(body.loginUrl) };
    }
    if (body.creditsExhausted) {
      return {
        kind: "credits_exhausted",
        billingUrl:
          typeof body.billingUrl === "string" ? body.billingUrl : undefined,
        message:
          typeof body.message === "string"
            ? body.message
            : "You've used your included free plan credits.",
      };
    }
    if (
      body.error === "free_org_rate_limited" ||
      typeof body.reason === "string"
    ) {
      return {
        kind: "credits_exhausted",
        message:
          typeof body.message === "string"
            ? body.message
            : "You've reached your included chat quota for this workspace.",
      };
    }
  }

  if (status >= 502 && status <= 504) {
    return { kind: "cloud_unavailable" };
  }

  return null;
}

function parseOpenAiErrorMessage(
  message: string
): { status: number; body: Record<string, unknown> } | null {
  const match = message.match(/^OpenAI request failed \((\d+) /);
  if (!match) return null;
  const status = Number(match[1]);
  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    const body = JSON.parse(message.slice(jsonStart)) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return { status, body: body as Record<string, unknown> };
    }
  } catch {
    // not JSON
  }
  return null;
}

export function managedNoticeFromLlmError(
  error: unknown
): ManagedChatNotice | null {
  if (error instanceof Error && error.name === "LlmRequestError") {
    const status = (error as { status?: number }).status ?? 0;
    const body = (error as { body?: Record<string, unknown> }).body;
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? body
        : undefined;
    return noticeFromErrorBody(status, record);
  }

  if (error instanceof Error) {
    const parsed = parseOpenAiErrorMessage(error.message);
    if (parsed) {
      return noticeFromErrorBody(parsed.status, parsed.body);
    }
  }

  if (isCloudFetchFailure(error)) {
    return { kind: "cloud_unavailable" };
  }

  return null;
}

export function managedNoticeFromHttpResponse(
  status: number,
  body: Record<string, unknown> | null
): ManagedChatNotice | null {
  return noticeFromErrorBody(status, body);
}
