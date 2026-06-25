/**
 * Type-level test for outputSchema enforcement at the tool return position.
 *
 * A tool's `outputSchema` is inferred as `TOutput`. Helpers that carry
 * `structuredContent` (`object()`, `widget()`) must match `TOutput`; content-only
 * helpers (`text()`, `markdown()`, ...) carry no structuredContent and are always
 * allowed. No new API: the existing idiomatic calls are simply type-checked.
 *
 * Run with `npm run test:types` (tsc --noEmit). Every `@ts-expect-error` line
 * MUST produce an error, or the check fails.
 */
import {
  object,
  text,
  widget,
} from "../../src/server/utils/response-helpers.js";
import type { ToolCallback } from "../../src/server/types/tool.js";

type WeatherInput = { city: string };
type WeatherOutput = { city: string; tempC: number };
type WeatherCb = ToolCallback<WeatherInput, WeatherOutput>;

// Content-only helper: always allowed regardless of outputSchema.
const okText: WeatherCb = async () => text("Sunny");

// object() whose shape matches outputSchema: allowed.
const okObject: WeatherCb = async () => object({ city: "Paris", tempC: 22 });

// object() with a wrong field type: rejected.
// @ts-expect-error tempC must be a number to match outputSchema
const badType: WeatherCb = async () => object({ city: "Paris", tempC: "warm" });

// object() missing a required field: rejected.
// @ts-expect-error tempC is required by outputSchema
const badMissing: WeatherCb = async () => object({ city: "Paris" });

// widget(): props become structuredContent, checked against outputSchema.
const okWidget: WeatherCb = async () =>
  widget({ props: { city: "Paris", tempC: 22 }, output: text("Paris: 22C") });

// widget() with props that do not match outputSchema: rejected.
const badWidgetProps = { city: "Paris", tempC: "warm" };
// @ts-expect-error widget props must match outputSchema
const badWidget: WeatherCb = async () => widget({ props: badWidgetProps });

// A tool with no outputSchema (TOutput defaults to Record<string, unknown>):
// any structured shape is accepted.
type LooseCb = ToolCallback<Record<string, never>>;
const looseObject: LooseCb = async () => object({ anything: 1, goes: true });

void [okText, okObject, badType, badMissing, okWidget, badWidget, looseObject];
