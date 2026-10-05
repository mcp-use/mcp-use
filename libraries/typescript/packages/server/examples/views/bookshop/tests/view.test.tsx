import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ViewRuntimeProvider } from "../../../../src/react/runtime/view-runtime-context.js";
import { createMcpAppRuntime } from "../../../../src/react/runtime/view-runtime.js";
import { normalizeViewConfig } from "../../../../src/react/runtime/view-config.js";
import { createPairedTransports } from "../../../../tests/helpers/paired-transport.js";
import { registerViews } from "mcp-use";
import server from "../src/index.js";
import BookshopView, { viewConfig } from "../views/bookshop/view.js";

server[registerViews]({
  bookshop: { kind: "inline", js: "", css: "", viewConfig },
});

// Use the same source runtime context for the View and test provider.
vi.mock("mcp-use/react", async () => import("../../../../src/react/index.js"));
const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  cleanup();
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": name,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "bookshop-dom-test",
              version: "1",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    })
  );
  const payload = await response.json();
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload.result;
}

async function mount() {
  for (const id of ["moonlit-atlas", "small-hours", "paper-planets"])
    await call("set_cart_item", { id, quantity: 0 });
  await call("settings.update", {
    set: { compact: false, showDescriptions: true },
  });
  const [guest, host] = createPairedTransports();
  const runtime = createMcpAppRuntime(normalizeViewConfig(viewConfig), {
    transport: guest,
  });
  const bridge = new AppBridge(
    null,
    { name: "dom-host", version: "1" },
    { serverTools: {}, updateModelContext: { text: {} } },
    {
      hostContext: {
        displayMode: "inline",
        availableDisplayModes: ["inline", "fullscreen"],
      },
    }
  );
  bridge.oncalltool = ({ name, arguments: args }) => call(name, args ?? {});
  bridge.onupdatemodelcontext = async () => ({});
  const modeRequests = vi.fn(
    async ({ mode }: { mode: "inline" | "fullscreen" | "pip" }) => ({ mode })
  );
  bridge.onrequestdisplaymode = modeRequests;
  await bridge.connect(host);
  disposals.push(
    () => runtime.dispose(),
    () => bridge.close()
  );
  render(
    <ViewRuntimeProvider runtime={runtime}>
      <BookshopView />
    </ViewRuntimeProvider>
  );
  expect(screen.getByRole("status").textContent).toContain("Opening");
  await act(async () => {
    await runtime.connect();
    await bridge.sendToolInput({ arguments: {} });
    await bridge.sendToolResult(await call("open_bookshop"));
  });
  await screen.findByRole("heading", { name: "Little Bookshop" });
  return { bridge, modeRequests };
}

it("UI buttons persist cart changes through the real bridge and server tools", async () => {
  await mount();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Add to demo cart" })[0]!
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Demo cart (1)" })).toBeTruthy()
  );
  const current = await call("read_cart");
  expect(current.structuredContent.cart[0].quantity).toBe(1);
  expect(current.structuredContent.totalCents).toBe(1800);
  fireEvent.click(screen.getByRole("button", { name: "Demo cart (1)" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Quantity" }), {
    target: { value: "3" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Demo cart (3)" })).toBeTruthy()
  );
  expect((await call("read_cart")).structuredContent.totalCents).toBe(5400);
  fireEvent.change(screen.getByRole("combobox", { name: "Quantity" }), {
    target: { value: "0" },
  });
  await screen.findByText(
    "Your cart is empty. Browse the books to add a story."
  );
  expect((await call("read_cart")).structuredContent.cart).toEqual([]);
});

it("search, details, host deep links, display requests, refresh, and errors", async () => {
  const { bridge, modeRequests } = await mount();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "paper" },
  });
  expect(
    screen.getAllByRole("button", { name: "Add to demo cart" })
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Details for Paper Planets" })
  );
  expect(screen.getByRole("heading", { name: "Paper Planets" })).toBeTruthy();
  await act(async () => {
    await bridge.sendHostContextChange({ "openai/deepLink": { url: "/cart" } });
  });
  expect(screen.getByRole("heading", { name: "Your demo cart" })).toBeTruthy();
  await act(async () => {
    await bridge.sendHostContextChange({
      "openai/deepLink": { url: "/products/not-a-book" },
      theme: "dark",
    });
  });
  expect(
    screen.getByRole("heading", { name: "Bookshop page not found" })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  await waitFor(() =>
    expect(modeRequests).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "fullscreen" }),
      expect.anything()
    )
  );
  await act(async () => {
    await bridge.sendHostContextChange({ displayMode: "fullscreen" });
  });
  await screen.findByRole("button", { name: "Show inline" });
  await call("settings.update", {
    set: { compact: true, showDescriptions: false },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(document.querySelector(".bookshop.compact.dark")).toBeTruthy()
  );
  bridge.oncalltool = async () => {
    throw new Error("Demo transport failure");
  };
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain(
    "Demo transport failure"
  );
});
