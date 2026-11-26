// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FullscreenChatOverlay } from "../FullscreenChatOverlay";
import type { Message } from "../types";

vi.mock("../MessageList", () => ({ MessageList: () => null }));

const typed: Message = {
  id: "u1",
  role: "user",
  content: "Show the demo",
  timestamp: 0,
};
const hidden: Message = {
  id: "u2",
  role: "user",
  content: "Internal app instruction",
  displayContent: "",
  timestamp: 1,
};
const visible: Message = {
  id: "u3",
  role: "user",
  content: "Plain follow-up",
  timestamp: 2,
};

describe("FullscreenChatOverlay drawer", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (messages: Message[]) =>
    act(async () =>
      root.render(<FullscreenChatOverlay messages={messages} isLoading />)
    );
  const drawerOpen = () =>
    container.querySelector('[data-testid="fullscreen-chat-drawer"]') !== null;

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    document.documentElement.setAttribute("data-mcp-widget-fullscreen", "");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await render([typed]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.removeAttribute("data-mcp-widget-fullscreen");
  });

  it("stays closed for a model-only follow-up", async () => {
    await render([typed, hidden]);
    expect(drawerOpen()).toBe(false);
  });

  it("opens for a visible follow-up", async () => {
    await render([typed, visible]);
    expect(drawerOpen()).toBe(true);
  });
});
