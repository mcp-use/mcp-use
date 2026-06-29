import type { PostHogOptions } from "posthog-node";

type PostHogFetchFn = NonNullable<PostHogOptions["fetch"]>;

/**
 * PostHog `fetch` override that does not surface network/HTTP failures to the SDK
 * (avoids `@posthog/core` `logFlushError` / `console.error` on flush/shutdown).
 */
export const telFetch: PostHogFetchFn = async (url, options) => {
  try {
    const res = await fetch(url, options);
    if (res.status >= 200 && res.status < 400) {
      return res as Awaited<ReturnType<PostHogFetchFn>>;
    }
  } catch {
    // Telemetry must not log or break the host app
  }
  return {
    status: 200,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve({}),
  };
};
