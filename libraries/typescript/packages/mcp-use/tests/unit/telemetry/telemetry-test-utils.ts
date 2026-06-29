import { expect, vi } from "vitest";

type RawPostHogBatchEvent = {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
};

const originalFetch = globalThis.fetch;

const mockTelemetryFetch = vi.fn(async () => new Response("", { status: 200 }));

export function installTelemetryFetchMock(): void {
  globalThis.fetch = mockTelemetryFetch as typeof fetch;
  mockTelemetryFetch.mockClear();
}

export async function flushPostHogTelemetry(): Promise<void> {
  // Fire-and-forget telemetry call sites queue PostHog events synchronously,
  // then await Scarf fetches. Let those promises run before forcing a batch.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const { Telemetry } =
    await import("../../../src/telemetry/telemetry-node.js");
  await Telemetry.getInstance().shutdown();
}

export function restoreTelemetryFetchMock(): void {
  globalThis.fetch = originalFetch;
}

function getPostHogBatchEvents(): RawPostHogBatchEvent[] {
  return mockTelemetryFetch.mock.calls.flatMap(([url, options]) => {
    if (!String(url).includes("/batch/")) {
      return [];
    }

    const body = options?.body;
    if (typeof body !== "string") {
      return [];
    }

    const payload = JSON.parse(body) as { batch?: RawPostHogBatchEvent[] };
    return payload.batch ?? [];
  });
}

export async function expectPostHogEvent(
  eventName: string
): Promise<RawPostHogBatchEvent> {
  await flushPostHogTelemetry();

  const event = [...getPostHogBatchEvents()]
    .reverse()
    .find((entry) => entry.event === eventName);
  expect(event).toBeDefined();
  return event!;
}
