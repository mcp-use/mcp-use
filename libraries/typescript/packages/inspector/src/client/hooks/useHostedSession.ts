/** Shared OAuth-backed Manufact identity for hosted Inspector UI. */
import {
  useManufactAuth,
  type ManufactUser,
} from "@/client/auth/manufact-auth";

export type HostedUser = ManufactUser;

/**
 * @param chatApiUrl - Hosted chat endpoint. When undefined/null the hook stays
 *   idle (no fetch) — local/BYOK inspector has no Manufact session to probe.
 */
export function useHostedSession(
  chatApiUrl: string | null | undefined
): ReturnType<typeof useManufactAuth> {
  return useManufactAuth(chatApiUrl);
}
