/**
 * `events/list` (PLAN.md §6.6, D26): effective modes, `visible`, per-profile
 * listing order and paging.
 *
 * @internal
 */

import type {
  DeliveryMode,
  EventDescriptor,
  ListEventsResult,
  ProfileAxes,
} from "@mcp-use/events-core";
import type { RegisteredEvent, EventsRegistry } from "../internal/registry.js";

/** Server configuration that decides which modes are served (never the caller). */
export interface ModeEnvironment {
  /** A principal source exists for webhooks under this profile (OAuth, dev, or anonymous for `openai`). */
  webhookPrincipalSource: boolean;
  /** `events.poll.enabled` resolved. */
  pollEnabled: boolean;
  /** `events.push.enabled` resolved for this runtime. */
  pushEnabled: boolean;
}

/** The `sep-3415` listing order. */
const SERVABLE_ORDER: readonly DeliveryMode[] = ["webhook", "push", "poll"];

/**
 * Effective modes of one event (D26), in the `sep-3415` order.
 *
 * @param ev - The registered event.
 * @param env - The server's mode environment.
 */
export function effectiveModes(
  ev: Pick<RegisteredEvent, "definition" | "replay">,
  env: ModeEnvironment
): DeliveryMode[] {
  const d = ev.definition.delivery ?? {};
  const on: Record<DeliveryMode, boolean> = {
    webhook: d.webhook !== false && env.webhookPrincipalSource,
    push: d.push !== false && env.pushEnabled,
    poll: ev.replay !== false && d.poll !== false && env.pollEnabled,
  };
  return SERVABLE_ORDER.filter((m) => on[m]);
}

/**
 * The modes a profile lists and serves: `webhookOnly` keeps only webhook;
 * `servable` (and unknown values) keeps every effective mode.
 */
export function profileModes(
  modes: readonly DeliveryMode[],
  listedModes: ProfileAxes["listedModes"]
): DeliveryMode[] {
  return listedModes === "webhookOnly"
    ? modes.filter((m) => m === "webhook")
    : [...modes];
}

/** Page size of `events/list`. */
export const LIST_PAGE_SIZE = 100;

function encodePageCursor(offset: number, catalogHash: string): string {
  return btoa(JSON.stringify({ offset, catalogHash }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodePageCursor(
  cursor: string | undefined,
  catalogHash: string
): number {
  if (cursor === undefined) return 0;
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const v = JSON.parse(atob(b64)) as { offset?: unknown; catalogHash?: unknown };
    if (
      v.catalogHash === catalogHash &&
      typeof v.offset === "number" &&
      Number.isInteger(v.offset) &&
      v.offset >= 0
    )
      return v.offset;
  } catch {
    // An unreadable cursor restarts from the first page.
  }
  return 0;
}

/** Inputs of {@link listEvents}. */
export interface ListEventsInput {
  registry: EventsRegistry;
  axes: Pick<ProfileAxes, "listedModes">;
  env: ModeEnvironment;
  /** Runs the event's `visible(ctx)`; resolves `true` when visible. */
  isVisible(ev: RegisteredEvent): Promise<boolean>;
  /** Events missing from the active catalog (dormant, D32). */
  isDormant?(name: string): boolean;
  cursor?: string;
}

/**
 * Builds one page of `events/list`. Hidden events and events with no mode for
 * this profile are omitted. A cursor minted for another catalog hash restarts
 * from 0.
 */
export async function listEvents(
  input: ListEventsInput
): Promise<ListEventsResult> {
  const eligible: EventDescriptor[] = [];
  for (const ev of input.registry.all()) {
    if (input.isDormant?.(ev.name)) continue;
    const delivery = profileModes(
      effectiveModes(ev, input.env),
      input.axes.listedModes
    );
    if (delivery.length === 0) continue;
    if (!(await input.isVisible(ev))) continue;
    const desc: EventDescriptor = {
      name: ev.name,
      description: ev.definition.description,
      delivery,
      inputSchema: ev.inputJsonSchema,
      payloadSchema: ev.payloadJsonSchema,
    };
    if (ev.definition._meta !== undefined) desc._meta = ev.definition._meta;
    eligible.push(desc);
  }
  const hash = input.registry.catalogHash;
  const offset = decodePageCursor(input.cursor, hash);
  const events = eligible.slice(offset, offset + LIST_PAGE_SIZE);
  const result: ListEventsResult = { events };
  if (offset + LIST_PAGE_SIZE < eligible.length)
    result.nextCursor = encodePageCursor(offset + LIST_PAGE_SIZE, hash);
  return result;
}
