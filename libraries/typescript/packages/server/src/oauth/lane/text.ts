import { LANE_SESSION_INFO_TOOL, LANE_STEP_UP_TOOL } from "./types.js";

/**
 * Paragraphs appended to the server's `initialize` instructions. This text is
 * Lane's steering mechanism: it is what makes an agent call the step-up tool.
 *
 * @internal
 */
export function laneStepUpInstruction(): string {
  return (
    `Authentication is not complete until you call \`${LANE_STEP_UP_TOOL}\` on this server. ` +
    "Other tools are unavailable until you do. Call it once, with a one-line summary " +
    "of what you are trying to accomplish, and then retry what you were doing.\n\n" +
    "Working across more than one Lane server in the same task: reuse the SAME agent " +
    `session and call \`${LANE_STEP_UP_TOOL}\` once on each server — once per server, not ` +
    "once per tool call. Do not carry an access token from another server to this one: " +
    "a Lane access token names exactly one audience, so a token minted for a different " +
    "server is refused here. What carries across servers is the session, not the token."
  );
}

/**
 * Appends the step-up instruction to operator instructions. Idempotent.
 *
 * @internal
 */
export function decorateLaneInstructions(current: string | undefined): string {
  const sentence = laneStepUpInstruction();
  if (current === undefined || current.trim().length === 0) return sentence;
  return current.includes(LANE_STEP_UP_TOOL)
    ? current
    : `${current.trim()}\n\n${sentence}`;
}

/**
 * Error result text a gated tool answers with before the step-up.
 *
 * @internal
 */
export function laneStepUpRequiredMessage(): string {
  return (
    `Login incomplete — call \`${LANE_STEP_UP_TOOL}\` with a brief summary of your task, ` +
    "then retry this call."
  );
}

/**
 * Error result text when the connection lacks a required scope.
 *
 * @internal
 */
export function laneInsufficientScopeMessage(scope: string): string {
  return `insufficient_scope: this connection lacks \`${scope}\``;
}

/**
 * `tools/list` description of the step-up tool.
 *
 * @internal
 */
export function laneStepUpToolDescription(): string {
  return (
    "Complete authentication for this server. Call this once before using other " +
    "tools. Optionally include a one-line summary of your task so results can be " +
    "tailored to it; the call works with no arguments at all."
  );
}

/**
 * `tools/list` description of the session-info tool.
 *
 * @internal
 */
export function laneSessionInfoDescription(): string {
  return (
    "What Lane knows about this session: who is calling, whether they have " +
    "completed the step-up, and what that connection is allowed to do. Works " +
    "before the step-up — call it to confirm an auth integration worked."
  );
}

/**
 * Markdown body of the auth-guide resource, generated from live configuration
 * so it cannot drift from what the server serves.
 *
 * @internal
 */
export function laneAuthGuideText(options: {
  sessionInfo: boolean;
  metadataUrl: string;
}): string {
  const sections = [
    "# Registering a session with this server",
    "",
    `Call \`${LANE_STEP_UP_TOOL}\` once on this server before calling anything`,
    "else. Other tools refuse until you do, and the refusal names this tool.",
    "",
    "It takes one optional argument, `task`: a single line, in the user’s own",
    "terms, describing what you are trying to accomplish. It is used to tailor",
    "results. The call works with no arguments at all.",
    "",
    "## Working across more than one Lane server",
    "",
    `Reuse the SAME agent session, and call \`${LANE_STEP_UP_TOOL}\` once on each`,
    "server — once per server, not once per tool call.",
    "",
    "Do NOT carry an access token from another server to this one. A Lane access",
    "token names exactly one audience, so a token minted for a different server is",
    "refused here. What carries across servers is the session, not the token.",
  ];
  if (options.sessionInfo) {
    sections.push(
      "",
      "## Checking it worked",
      "",
      `\`${LANE_SESSION_INFO_TOOL}\` reports what Lane knows about this connection: whether a`,
      "grant exists, its scopes, and when it expires. `connected: false` with an",
      "identity still reported means the bearer verified but no session is recorded",
      `— call \`${LANE_STEP_UP_TOOL}\`.`
    );
  }
  sections.push(
    "",
    "## Where to authenticate",
    "",
    "This server publishes its authorization server at",
    `\`${options.metadataUrl}\` (RFC 9728).`,
    "Every unauthenticated request to the MCP endpoint is answered with `401` and a",
    "`WWW-Authenticate` header naming that document."
  );
  return sections.join("\n");
}

/**
 * Caps and de-fangs model-authored text before it is stored.
 *
 * @internal
 */
export function sanitizeLaneTask(value: string, maxChars: number): string {
  return (
    value
      // Stripping control characters is the point of this line.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .trim()
      .slice(0, maxChars)
  );
}
