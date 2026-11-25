/**
 * Delivery-profile axes (D7, D53). A profile is a set of independent axes;
 * presets name a set of values. Axis values are parsed as open strings so a
 * stored record written by a newer build survives a read by an older one.
 *
 * @packageDocumentation
 */

/** The axes of a delivery profile. Each axis changes one wire behaviour. */
export interface ProfileAxes {
  /** `webhook-id` on event deliveries: the normalized `eventId` (`openai`) or a fresh `msg_…` id (`sep-3415`). */
  webhookId: "eventId" | "random" | (string & {});
  /** `headerSafe` replaces ids not matching `^[A-Za-z0-9_-]{1,128}$` with `evt_` + 27 base64url characters of their SHA-256; `none` keeps them. */
  eventIdNormalization: "headerSafe" | "none" | (string & {});
  /** Numbering of the five Events error kinds: `sketch` (−32011…), `sep` (−32023…) or `documented` (−32602 with `data.kind`). */
  errorCodes: "sketch" | "sep" | "documented" | (string & {});
  /** Result of an unsubscribe that matches nothing: `{}` (`empty`) or NotFound `{kind:"subscription"}` (`notFound`). */
  unsubscribeMissing: "empty" | "notFound" | (string & {});
  /** Whether `gap` and `terminated` webhook control envelopes are sent. */
  controlEnvelopes: boolean;
  /** Whether a refresh result carries `deliveryStatus`. */
  refreshDeliveryStatus: boolean;
  /** Which modes `events/list` lists, and whether poll and push are served: `webhookOnly` or every `servable` mode. */
  listedModes: "webhookOnly" | "servable" | (string & {});
  /** `false`: every cursor is `null` and supplied cursors are ignored. `true`: MAC'd `c1.` cursors with replay. */
  replayCursors: boolean;
}

/** The name of one profile axis. */
export type ProfileAxisName = keyof ProfileAxes;

/**
 * The axis values this build knows, per axis. A stored profile with any other
 * value is kept but not delivered until it is re-resolved (D53).
 */
export const KNOWN_AXIS_VALUES: {
  readonly [K in ProfileAxisName]: readonly ProfileAxes[K][];
} = {
  webhookId: ["eventId", "random"],
  eventIdNormalization: ["headerSafe", "none"],
  errorCodes: ["sketch", "sep", "documented"],
  unsubscribeMissing: ["empty", "notFound"],
  controlEnvelopes: [true, false],
  refreshDeliveryStatus: [true, false],
  listedModes: ["webhookOnly", "servable"],
  replayCursors: [true, false],
};

/** Every axis name, in the order of {@link ProfileAxes}. */
export const PROFILE_AXIS_NAMES: readonly ProfileAxisName[] = [
  "webhookId",
  "eventIdNormalization",
  "errorCodes",
  "unsubscribeMissing",
  "controlEnvelopes",
  "refreshDeliveryStatus",
  "listedModes",
  "replayCursors",
];

const BOOLEAN_AXES: ReadonlySet<ProfileAxisName> = new Set([
  "controlEnvelopes",
  "refreshDeliveryStatus",
  "replayCursors",
]);

/**
 * Lists the axes whose value this build does not know: an absent axis, a
 * value of the wrong type, or a string value outside
 * {@link KNOWN_AXIS_VALUES}.
 *
 * @param axes - Axes read from a stored record or a configuration.
 * @returns The names of the unknown axes, empty when every axis is known.
 */
export function unknownAxes(
  axes: Readonly<Record<string, unknown>>
): ProfileAxisName[] {
  const out: ProfileAxisName[] = [];
  for (const name of PROFILE_AXIS_NAMES) {
    const known = KNOWN_AXIS_VALUES[name] as readonly unknown[];
    if (!known.includes(axes[name])) out.push(name);
  }
  return out;
}

/**
 * Checks that a value has the shape of a {@link ProfileAxes}: every axis
 * present, string axes as strings and boolean axes as booleans. Unknown string
 * values pass (axis values are open strings, D53).
 *
 * @param value - The value to check.
 * @returns `true` when `value` can be used as `ProfileAxes`.
 */
export function isProfileAxes(value: unknown): value is ProfileAxes {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return PROFILE_AXIS_NAMES.every((name) =>
    BOOLEAN_AXES.has(name)
      ? typeof record[name] === "boolean"
      : typeof record[name] === "string"
  );
}

/**
 * Checks a partial axes object, as used by `overrides` and `compatibility.axes`:
 * only known axis names, each with the right type.
 *
 * @param value - The value to check.
 * @returns `undefined` when valid, otherwise the first offending axis name (or `"<root>"`).
 */
export function invalidPartialAxes(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "<root>";
  }
  for (const [name, axisValue] of Object.entries(value)) {
    if (!(PROFILE_AXIS_NAMES as readonly string[]).includes(name)) return name;
    const expected = BOOLEAN_AXES.has(name as ProfileAxisName)
      ? "boolean"
      : "string";
    if (typeof axisValue !== expected) return name;
  }
  return undefined;
}
