import assert from "node:assert/strict";
import { MCPClient } from "@mcp-use/client";

const url = process.env.BOOKSHOP_URL ?? "http://127.0.0.1:3217/mcp";
const config = {
  mcpServers: { shop: { url, protocolNegotiation: "modern", oauth: false } },
};
const client = new MCPClient(config);
const otherClient = new MCPClient(config);
try {
  const shop = await client.createSession("shop");
  const other = await otherClient.createSession("shop");
  assert.equal(shop.info.protocolEra, "modern");
  assert.deepEqual(shop.info.capabilities.extensions["openai/settings"], {
    readTool: "settings.read",
    updateTool: "settings.update",
  });
  const tools = await shop.listTools();
  const launcher = tools.find((tool) => tool.name === "open_bookshop");
  assert.deepEqual(launcher._meta["openai/ui"].entrypoints, [
    { type: "global" },
    { type: "thread" },
  ]);
  const uri = launcher._meta.ui.resourceUri;
  const resource = await shop.readResource(uri);
  const html = resource.contents[0];
  assert.deepEqual(html._meta["openai/ui"], {
    availableDisplayModes: ["inline", "fullscreen"],
    preferredDisplayMode: "inline",
  });
  assert.match(html.mimeType, /text\/html/);
  const entry = html.text.match(/<script type="module" src="([^"]+)"/)[1];
  const script = await fetch(new URL(entry, url));
  assert.equal(script.status, 200);
  assert.match(await script.text(), /Little Bookshop/);

  const call = async (connection, name, args = {}) => {
    const result = await connection.callTool(name, args);
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.ok(result.structuredContent);
    return result.structuredContent;
  };
  for (const id of ["moonlit-atlas", "small-hours", "paper-planets"])
    await call(shop, "set_cart_item", { id, quantity: 0 });
  const launch = await call(shop, "open_bookshop");
  assert.equal(launch.books.length, 3);
  assert.equal(launch.route, "/books");
  const detail = await call(shop, "open_bookshop", {
    route: "/products/moonlit-atlas",
  });
  assert.equal(detail.route, "/products/moonlit-atlas");
  await call(shop, "set_cart_item", { id: "moonlit-atlas", quantity: 2 });
  const current = await call(other, "read_cart");
  assert.equal(current.totalCents, 3600);
  assert.deepEqual(
    current.cart.map(({ id, quantity }) => ({ id, quantity })),
    [{ id: "moonlit-atlas", quantity: 2 }]
  );
  await call(other, "set_cart_item", { id: "moonlit-atlas", quantity: 2 });
  assert.equal((await call(shop, "read_cart")).totalCents, 3600);
  for (const args of [
    { id: "unknown", quantity: 1 },
    { id: "moonlit-atlas", quantity: 10 },
    { id: "moonlit-atlas", quantity: -1 },
    { id: "moonlit-atlas", quantity: 1.5 },
  ]) {
    await assert.rejects(() => call(shop, "set_cart_item", args));
  }
  await call(shop, "settings.update", {
    set: { showDescriptions: true, compact: false },
  });
  await call(shop, "settings.update", { set: { compact: true } });
  const settings = await call(other, "settings.read");
  assert.deepEqual(settings.values, { showDescriptions: true, compact: true });
  assert.ok(settings.layout.length);
  assert.deepEqual((await call(other, "read_cart")).settings, settings.values);
  for (const set of [{}, { compact: "yes" }, { unknown: true }])
    await assert.rejects(() => call(shop, "settings.update", { set }));
  await call(shop, "set_cart_item", { id: "moonlit-atlas", quantity: 0 });
  assert.equal((await call(other, "read_cart")).cart.length, 0);
  await call(shop, "settings.update", {
    set: { showDescriptions: true, compact: false },
  });
  console.log(
    "PASS: real HTTP MCP discovery, entrypoints, HTML/JS resource, cart across two connections, schema rejection, and partial settings updates."
  );
} finally {
  await Promise.all([
    client.closeAllSessions(),
    otherClient.closeAllSessions(),
  ]);
}
