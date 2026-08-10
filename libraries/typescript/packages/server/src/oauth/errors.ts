import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

/** @internal Creates an OAuth invalid-token error with an optional cause. */
export function invalidToken(message: string, cause?: unknown): OAuthError {
  const error = new OAuthError(OAuthErrorCode.InvalidToken, message);
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}
