/**
 * The preset registry (`openai@1`, `sep-3415@1`), profile resolution in the
 * D7 order, and the D53 rules for profiles stored on records.
 *
 * @packageDocumentation
 */

import { isProfileAxes, unknownAxes, type ProfileAxes } from "./axes.js";
import {
  findKnownClient,
  KNOWN_CLIENTS,
  type KnownClientRule,
  type PresetId,
} from "./known-clients.js";
import type { EventsSignals } from "./signals.js";

/** One entry of the preset registry. */
export interface PresetDefinition {
  /** The preset family, `openai` or `sep-3415`. */
  preset: string;
  /** The revision within the family; a spec revision ships as a new revision. */
  revision: number;
  /** The axis values of this preset. */
  axes: ProfileAxes;
  /** What the preset implements, with the document revision it was written against. */
  source: string;
}

/**
 * The preset registry, keyed by preset id (`<family>@<revision>`). A spec
 * revision ships as a new row (for example `sep-3415@2`) with no engine change.
 */
export const PRESETS: Readonly<Record<string, PresetDefinition>> = {
  "openai@1": {
    preset: "openai",
    revision: 1,
    axes: {
      webhookId: "eventId",
      eventIdNormalization: "headerSafe",
      errorCodes: "sketch",
      unsubscribeMissing: "empty",
      controlEnvelopes: false,
      refreshDeliveryStatus: false,
      listedModes: "webhookOnly",
      replayCursors: false,
    },
    source:
      "OpenAI MCP Events page (read 2026-11-24) and the design sketch at 28ec35e (docs/design-sketch-proposal.md)",
  },
  "sep-3415@1": {
    preset: "sep-3415",
    revision: 1,
    axes: {
      webhookId: "random",
      eventIdNormalization: "none",
      errorCodes: "sep",
      unsubscribeMissing: "notFound",
      controlEnvelopes: true,
      refreshDeliveryStatus: true,
      listedModes: "servable",
      replayCursors: true,
    },
    source:
      "SEP-3415 events.mdx at c77b843 (modelcontextprotocol/ext-triggers-events)",
  },
};

/**
 * Splits a preset id into family and revision. Ids are open strings, so an id
 * the registry does not hold still parses (`sep-3415@2`).
 *
 * @param id - A preset id such as `openai@1`.
 * @returns The family and revision, or `undefined` when `id` is not `<family>@<positive integer>`.
 */
export function parsePresetId(
  id: string
): { preset: string; revision: number } | undefined {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)@([1-9][0-9]*)$/.exec(id);
  if (!m) return undefined;
  return { preset: m[1] as string, revision: Number(m[2]) };
}

/** How a profile was chosen (the D7 step that decided it). */
export type ProfileVia =
  | "forced"
  | "hook"
  | "known-client"
  | "method"
  | "era"
  | "declaration"
  | "mcp-name"
  | "openai-disabled"
  | "ambiguous"
  | (string & {});

/** The configuration profile resolution reads (`EventsConfig.compatibility`). */
export interface CompatibilityConfig {
  /** Advertise the top-level key and allow the `openai` profile; default `true`. `false` resolves step 8 to `sep-3415`. */
  openai?: boolean;
  /** Force one preset for every request (`"auto"` or absent: do not force). A bare family (`"sep-3415"`) means its highest registered revision. */
  dialect?: "auto" | PresetId;
  /** The preset for modern requests with no stronger signal (D7 step 9); default `openai@1`. A bare family is accepted. */
  ambiguous?: PresetId;
  /** Whether a missing `Mcp-Name` is accepted on `sep-3415` requests; default `lenient` (D9). */
  mcpName?: "lenient" | "strict";
  /** Known-client rows tried before {@link KNOWN_CLIENTS}. */
  knownClients?: readonly KnownClientRule[];
  /** Axis overrides applied after preset resolution, on every request. */
  axes?: Partial<ProfileAxes>;
  /** A hook consulted after a forced dialect and before the known-client rows; `undefined` falls through. */
  resolveDialect?: (signals: EventsSignals) =>
    | PresetId
    | {
        /** The preset to use. */
        preset: PresetId;
        /** Axis values that replace the preset's. */
        overrides?: Partial<ProfileAxes>;
      }
    | undefined;
}

/** The outcome of {@link resolveProfile}: what is pinned on a record as its profile. */
export interface ResolvedProfile {
  /** The preset family. */
  preset: string;
  /** The preset revision. */
  revision: number;
  /** The effective axes: the preset's, then row or hook overrides, then `compatibility.axes`. */
  axes: ProfileAxes;
  /** Which resolution step decided. */
  via: ProfileVia;
  /** The known-client row that matched, when `via` is `known-client`. */
  row?: KnownClientRule;
}

/** Facts about the request that profile resolution needs beyond the signals. */
export interface ProfileRequest {
  /** The JSON-RPC method, for example `events/poll`. */
  method?: string;
}

/** Thrown when configuration or a hook names a preset the registry does not hold. */
export class UnknownPresetError extends Error {
  /** The preset id that was not found. */
  readonly presetId: string;

  /**
   * @param presetId - The id that is not in {@link PRESETS}.
   */
  constructor(presetId: string) {
    super(`Unknown Events preset "${presetId}"`);
    this.name = "UnknownPresetError";
    this.presetId = presetId;
  }
}

/**
 * Looks a preset up in the registry. A full id (`sep-3415@1`) must be
 * registered; a bare family name (`sep-3415`, the `DialectId` form that
 * server configuration uses) selects the family's highest registered
 * revision.
 *
 * @param id - A preset id or a bare family name.
 * @returns The registry entry.
 * @throws {@link UnknownPresetError} when the registry holds no such preset or family.
 */
export function presetById(id: string): PresetDefinition {
  const exact = PRESETS[id];
  if (exact) return exact;
  if (!id.includes("@")) {
    let best: PresetDefinition | undefined;
    for (const def of Object.values(PRESETS)) {
      if (def.preset === id && (!best || def.revision > best.revision)) {
        best = def;
      }
    }
    if (best) return best;
  }
  throw new UnknownPresetError(id);
}

function build(
  id: string,
  via: ProfileVia,
  overrides: Partial<ProfileAxes> | undefined,
  config: CompatibilityConfig | undefined,
  row?: KnownClientRule
): ResolvedProfile {
  const def = presetById(id);
  const axes: ProfileAxes = { ...def.axes, ...overrides, ...config?.axes };
  const out: ResolvedProfile = {
    preset: def.preset,
    revision: def.revision,
    axes,
    via,
  };
  if (row) out.row = row;
  return out;
}

/**
 * Resolves the delivery profile of one `events/*` request in the D7 order:
 * 1. `compatibility.dialect` forced;
 * 2. the `compatibility.resolveDialect` hook;
 * 3. known-client rows (`compatibility.knownClients`, then {@link KNOWN_CLIENTS});
 * 4. `events/poll` or `events/stream` ⇒ `sep-3415@1`;
 * 5. legacy era ⇒ `openai@1`;
 * 6. the client declares the Events extension ⇒ `sep-3415@1`;
 * 7. `Mcp-Name` present on `events/subscribe` or `events/unsubscribe` ⇒ `sep-3415@1`;
 * 8. `compatibility.openai: false` ⇒ `sep-3415@1`;
 * 9. `compatibility.ambiguous` (default `openai@1`).
 *
 * `compatibility.axes` is applied last on every path.
 *
 * @param signals - What the server observed about the client.
 * @param config - `EventsConfig.compatibility`.
 * @param request - The request method, which step 4 and 7 read; without it step 4 is skipped and step 7 reads the signal as is.
 * @returns The resolved preset, axes, deciding step and matched row.
 * @throws {@link UnknownPresetError} when the forced dialect, the hook, a row or `ambiguous` names a preset the registry does not hold.
 */
export function resolveProfile(
  signals: EventsSignals,
  config?: CompatibilityConfig,
  request?: ProfileRequest
): ResolvedProfile {
  if (config?.dialect !== undefined && config.dialect !== "auto") {
    return build(config.dialect, "forced", undefined, config);
  }
  const hooked = config?.resolveDialect?.(signals);
  if (hooked !== undefined) {
    return typeof hooked === "string"
      ? build(hooked, "hook", undefined, config)
      : build(hooked.preset, "hook", hooked.overrides, config);
  }
  const rows = config?.knownClients
    ? [...config.knownClients, ...KNOWN_CLIENTS]
    : KNOWN_CLIENTS;
  const row = findKnownClient(signals, rows);
  if (row) return build(row.preset, "known-client", row.overrides, config, row);
  const method = request?.method;
  if (method === "events/poll" || method === "events/stream") {
    return build("sep-3415@1", "method", undefined, config);
  }
  if (signals.era === "legacy")
    return build("openai@1", "era", undefined, config);
  if (signals.declaresEventsExtension) {
    return build("sep-3415@1", "declaration", undefined, config);
  }
  const mcpNameCounts =
    method === undefined ||
    method === "events/subscribe" ||
    method === "events/unsubscribe";
  if (mcpNameCounts && signals.mcpName.present) {
    return build("sep-3415@1", "mcp-name", undefined, config);
  }
  if (config?.openai === false) {
    return build("sep-3415@1", "openai-disabled", undefined, config);
  }
  return build(config?.ambiguous ?? "openai@1", "ambiguous", undefined, config);
}

/** A profile as stored on a subscription record (Appendix B `profile`). */
export interface StoredProfile {
  /** The preset family. */
  preset: string;
  /** The preset revision. */
  revision: number;
  /** The axes pinned when the record was resolved; authoritative on delivery. */
  axes: ProfileAxes;
  /** Which resolution step decided. */
  via: string;
}

/**
 * How a stored profile is treated (D53):
 * - `known`: preset and revision are in the registry and every axis value is known; deliver.
 * - `deliverable`: an unknown revision of a known preset whose axes are all known; deliver with the stored axes.
 * - `unknown`: an unknown preset or an unknown axis value; keep the record, skip it at fan-out (`profile_unknown`), re-resolve on the next refresh.
 */
export type StoredProfileStatus = "known" | "deliverable" | "unknown";

/**
 * Reads a stored profile without changing it: unknown presets, revisions,
 * axis values and extra fields are kept as they are, so a record written by a
 * newer build round-trips unchanged.
 *
 * @param raw - The `profile` value read from storage.
 * @returns The same object typed as {@link StoredProfile}, or `undefined` when its shape is broken (missing or mistyped fields).
 */
export function parseStoredProfile(raw: unknown): StoredProfile | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const p = raw as Record<string, unknown>;
  if (
    typeof p.preset !== "string" ||
    typeof p.revision !== "number" ||
    !Number.isInteger(p.revision) ||
    typeof p.via !== "string" ||
    !isProfileAxes(p.axes)
  ) {
    return undefined;
  }
  return raw as StoredProfile;
}

/**
 * Classifies a stored profile by the D53 rules.
 *
 * @param profile - A profile read with {@link parseStoredProfile}.
 * @returns Whether to deliver it as is, deliver it with its stored axes, or skip it until it is re-resolved.
 */
export function storedProfileStatus(
  profile: StoredProfile
): StoredProfileStatus {
  const knownFamily = Object.values(PRESETS).some(
    (p) => p.preset === profile.preset
  );
  if (!knownFamily) return "unknown";
  if (
    unknownAxes(profile.axes as unknown as Record<string, unknown>).length > 0
  ) {
    return "unknown";
  }
  const knownRevision = PRESETS[`${profile.preset}@${profile.revision}`];
  return knownRevision ? "known" : "deliverable";
}
