// Keep Inspector's published server bundle limited to the in-memory adapter.
// Source modules import the package root so security tooling can recognize the
// supported rate-limiter-flexible API; tsup aliases that import to this shim.
// @ts-expect-error -- this build-only alias resolves to the package's memory adapter.
export { default as RateLimiterMemory } from "inspector-rate-limiter-memory";
