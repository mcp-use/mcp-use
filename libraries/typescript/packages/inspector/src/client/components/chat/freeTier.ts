/**
 * Free-tier upgrade prompt visibility.
 *
 * The hosted inspector (inspector.manufact.com) shows a "Sign in to increase
 * your limits" CTA for anonymous visitors using Manufact's managed LLM. It must
 * NOT be shown to users who are already signed in — otherwise signed-in users
 * keep getting asked to log in (MCP-2142).
 *
 * Pure decision so it can be unit-tested without rendering React.
 */
interface FreeTierVisibilityInput {
  /** Chat is using the server-managed (Manufact) LLM, not a BYOK key. */
  isManaged: boolean;
  /** Host opted into the free-tier sign-in/upgrade UI (hosted inspector only). */
  enableFreeTierUpgrade: boolean;
  /** Visitor is signed in to Manufact (shared session cookie resolved). */
  isAuthenticated: boolean;
}

export function shouldShowFreeTierUpgrade({
  isManaged,
  enableFreeTierUpgrade,
  isAuthenticated,
}: FreeTierVisibilityInput): boolean {
  return isManaged && enableFreeTierUpgrade && !isAuthenticated;
}
