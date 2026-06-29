/**
 * Telemetry fetch helper that does not surface network/HTTP failures to callers.
 */
export const telFetch: typeof fetch = async (url, options) => {
  try {
    const res = await fetch(url, options);
    if (res.status >= 200 && res.status < 400) {
      return res;
    }
  } catch {
    // Telemetry must not log or break the host app
  }
  return new Response("", { status: 200 });
};
