/**
 * Serverless markers (PLAN.md D19): where no background pump may run.
 *
 * @internal
 */

import type { EventsEnvSnapshot } from "../env.js";

/** Whether the code runs inside Cloudflare Workers. */
export function isWorkersRuntime(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent === "Cloudflare-Workers";
}

/**
 * Whether any serverless marker is present (`VERCEL`,
 * `AWS_LAMBDA_FUNCTION_NAME`, `NETLIFY`, `DENO_DEPLOYMENT_ID`, Workers).
 *
 * @param snapshot - Parsed environment.
 */
export function hasServerlessMarker(snapshot: EventsEnvSnapshot): boolean {
  const s = snapshot.serverless;
  return s.vercel || s.lambda || s.netlify || s.deno || isWorkersRuntime();
}
