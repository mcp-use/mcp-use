export const DEFAULT_MANUFACT_CHAT_URL =
  "https://cloud.manufact.com/api/v1/inspector/chat/stream";

export function resolveManufactChatUrl(
  runtimeUrl?: string,
  buildTimeUrl?: string
): string {
  return (
    runtimeUrl?.trim() || buildTimeUrl?.trim() || DEFAULT_MANUFACT_CHAT_URL
  );
}
