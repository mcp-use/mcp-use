/**
 * Tests for callback resolution logic
 *
 * Covers:
 * - resolveCallbacks() precedence chain (config.ts)
 * - BaseConnector constructor deprecated-alias merging (base.ts)
 * - HttpConnector capability advertisement based on resolved callbacks
 *
 * Run with: pnpm test tests/unit/client/callback-resolution.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCallbacks } from "../../../src/config.js";
import type { CallbackConfig } from "../../../src/config.js";
import { BaseConnector } from "../../../src/connectors/base.js";
import { HttpConnector } from "../../../src/connectors/http.js";

const samplingA = vi.fn().mockResolvedValue({
  role: "assistant",
  content: { type: "text", text: "a" },
  model: "a",
  stopReason: "endTurn",
});
const samplingB = vi.fn().mockResolvedValue({
  role: "assistant",
  content: { type: "text", text: "b" },
  model: "b",
  stopReason: "endTurn",
});
const elicitA = vi.fn().mockResolvedValue({ action: "accept" as const });
const elicitB = vi.fn().mockResolvedValue({ action: "decline" as const });
const notifA = vi.fn();
const notifB = vi.fn();

describe("resolveCallbacks()", () => {
  describe("sampling precedence", () => {
    it("per-server onSampling wins over global onSampling", () => {
      const result = resolveCallbacks(
        { onSampling: samplingA },
        { onSampling: samplingB }
      );
      expect(result.onSampling).toBe(samplingA);
    });

    it("per-server deprecated samplingCallback wins over global onSampling", () => {
      const result = resolveCallbacks(
        { samplingCallback: samplingA },
        { onSampling: samplingB }
      );
      expect(result.onSampling).toBe(samplingA);
    });

    it("global onSampling used when per-server has none", () => {
      const result = resolveCallbacks({}, { onSampling: samplingB });
      expect(result.onSampling).toBe(samplingB);
    });

    it("global deprecated samplingCallback used as final fallback", () => {
      const result = resolveCallbacks({}, { samplingCallback: samplingB });
      expect(result.onSampling).toBe(samplingB);
    });

    it("per-server onSampling wins over per-server samplingCallback", () => {
      const result = resolveCallbacks(
        { onSampling: samplingA, samplingCallback: samplingB },
        {}
      );
      expect(result.onSampling).toBe(samplingA);
    });
  });

  describe("elicitation precedence", () => {
    it("per-server onElicitation wins over global onElicitation", () => {
      const result = resolveCallbacks(
        { onElicitation: elicitA },
        { onElicitation: elicitB }
      );
      expect(result.onElicitation).toBe(elicitA);
    });

    it("per-server deprecated elicitationCallback wins over global onElicitation", () => {
      const result = resolveCallbacks(
        { elicitationCallback: elicitA },
        { onElicitation: elicitB }
      );
      expect(result.onElicitation).toBe(elicitA);
    });

    it("global onElicitation used when per-server has none", () => {
      const result = resolveCallbacks({}, { onElicitation: elicitB });
      expect(result.onElicitation).toBe(elicitB);
    });

    it("global deprecated elicitationCallback used as final fallback", () => {
      const result = resolveCallbacks({}, { elicitationCallback: elicitB });
      expect(result.onElicitation).toBe(elicitB);
    });

    it("per-server onElicitation wins over per-server elicitationCallback", () => {
      const result = resolveCallbacks(
        { onElicitation: elicitA, elicitationCallback: elicitB },
        {}
      );
      expect(result.onElicitation).toBe(elicitA);
    });
  });

  describe("notification precedence", () => {
    it("per-server onNotification wins over global", () => {
      const result = resolveCallbacks(
        { onNotification: notifA },
        { onNotification: notifB }
      );
      expect(result.onNotification).toBe(notifA);
    });

    it("global onNotification used when per-server has none", () => {
      const result = resolveCallbacks({}, { onNotification: notifB });
      expect(result.onNotification).toBe(notifB);
    });
  });

  describe("edge cases", () => {
    it("both undefined returns all undefined", () => {
      const result = resolveCallbacks(undefined, undefined);
      expect(result.onSampling).toBeUndefined();
      expect(result.onElicitation).toBeUndefined();
      expect(result.onNotification).toBeUndefined();
    });

    it("empty objects return all undefined", () => {
      const result = resolveCallbacks({}, {});
      expect(result.onSampling).toBeUndefined();
      expect(result.onElicitation).toBeUndefined();
      expect(result.onNotification).toBeUndefined();
    });

    it("mixed: sampling from per-server, elicitation from global", () => {
      const result = resolveCallbacks(
        { onSampling: samplingA },
        { onElicitation: elicitB }
      );
      expect(result.onSampling).toBe(samplingA);
      expect(result.onElicitation).toBe(elicitB);
      expect(result.onNotification).toBeUndefined();
    });

    it("per-server undefined does not shadow global", () => {
      const perServer: CallbackConfig = { onSampling: undefined };
      const result = resolveCallbacks(perServer, { onSampling: samplingB });
      expect(result.onSampling).toBe(samplingB);
    });
  });
});

describe("BaseConnector constructor (deprecated alias merging)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("stores onSampling as-is", () => {
    const connector = new BaseConnector({ onSampling: samplingA });
    expect((connector as any).opts.onSampling).toBe(samplingA);
  });

  it("merges samplingCallback into onSampling when onSampling is absent", () => {
    const connector = new BaseConnector({ samplingCallback: samplingA });
    expect((connector as any).opts.onSampling).toBe(samplingA);
  });

  it("onSampling wins when both are provided", () => {
    const connector = new BaseConnector({
      onSampling: samplingA,
      samplingCallback: samplingB,
    });
    expect((connector as any).opts.onSampling).toBe(samplingA);
  });

  it("stores onElicitation as-is", () => {
    const connector = new BaseConnector({ onElicitation: elicitA });
    expect((connector as any).opts.onElicitation).toBe(elicitA);
  });

  it("merges elicitationCallback into onElicitation when onElicitation is absent", () => {
    const connector = new BaseConnector({ elicitationCallback: elicitA });
    expect((connector as any).opts.onElicitation).toBe(elicitA);
  });

  it("onElicitation wins when both are provided", () => {
    const connector = new BaseConnector({
      onElicitation: elicitA,
      elicitationCallback: elicitB,
    });
    expect((connector as any).opts.onElicitation).toBe(elicitA);
  });

  it("emits deprecation warning for samplingCallback", () => {
    new BaseConnector({ samplingCallback: samplingA });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("samplingCallback")
    );
  });

  it("emits deprecation warning for elicitationCallback", () => {
    new BaseConnector({ elicitationCallback: elicitA });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("elicitationCallback")
    );
  });

  it("no warnings when using canonical names only", () => {
    new BaseConnector({ onSampling: samplingA, onElicitation: elicitA });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("HttpConnector capability advertisement", () => {
  it("advertises sampling capability when onSampling is provided", () => {
    const connector = new HttpConnector("http://localhost:3000", {
      onSampling: samplingA,
    });
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.sampling).toEqual({});
  });

  it("does not advertise sampling when no callback is provided", () => {
    const connector = new HttpConnector("http://localhost:3000");
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.sampling).toBeUndefined();
  });

  it("advertises elicitation capability when onElicitation is provided", () => {
    const connector = new HttpConnector("http://localhost:3000", {
      onElicitation: elicitA,
    });
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.elicitation).toEqual({ form: {}, url: {} });
  });

  it("does not advertise elicitation when no callback is provided", () => {
    const connector = new HttpConnector("http://localhost:3000");
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.elicitation).toBeUndefined();
  });

  it("advertises both when both callbacks are provided", () => {
    const connector = new HttpConnector("http://localhost:3000", {
      onSampling: samplingA,
      onElicitation: elicitA,
    });
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.sampling).toEqual({});
    expect(options.capabilities.elicitation).toEqual({ form: {}, url: {} });
  });

  it("always advertises roots capability", () => {
    const connector = new HttpConnector("http://localhost:3000");
    const options = (connector as any).buildClientOptions();
    expect(options.capabilities.roots).toEqual({ listChanged: true });
  });
});
