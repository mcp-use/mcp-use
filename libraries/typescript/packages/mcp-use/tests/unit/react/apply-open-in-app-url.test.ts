import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SET_GLOBALS_EVENT_TYPE } from "../../../src/react/widget-types.js";
import { applyOpenInAppUrlFromConfig } from "../../../src/react/apply-open-in-app-url.js";

describe("applyOpenInAppUrlFromConfig", () => {
  beforeEach(() => {
    (global as any).window = {
      __mcpWidgetOpenai: undefined,
      openai: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });

  afterEach(() => {
    delete (global as any).window;
  });

  it("calls window.openai.setOpenInAppUrl when config and API are available", () => {
    const setOpenInAppUrl = vi.fn().mockResolvedValue(undefined);
    (global as any).window.__mcpWidgetOpenai = {
      openInAppUrl: "https://example.com/app",
    };
    (global as any).window.openai = { setOpenInAppUrl };

    applyOpenInAppUrlFromConfig();

    expect(setOpenInAppUrl).toHaveBeenCalledWith({
      href: "https://example.com/app",
    });
    expect((global as any).window.addEventListener).not.toHaveBeenCalled();
  });

  it("waits for openai:set_globals when setOpenInAppUrl is not ready yet", () => {
    (global as any).window.__mcpWidgetOpenai = {
      openInAppUrl: "https://example.com/app",
    };

    applyOpenInAppUrlFromConfig();

    expect((global as any).window.addEventListener).toHaveBeenCalledWith(
      SET_GLOBALS_EVENT_TYPE,
      expect.any(Function)
    );
  });

  it("does nothing when openInAppUrl is not configured", () => {
    const cleanup = applyOpenInAppUrlFromConfig();
    expect(cleanup).toEqual(expect.any(Function));
    expect((global as any).window.addEventListener).not.toHaveBeenCalled();
  });
});
