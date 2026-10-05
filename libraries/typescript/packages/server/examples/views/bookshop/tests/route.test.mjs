import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, pluginLink } from "../src/route.ts";

test("supported product/cart routes and untrusted incoming URLs", () => {
  assert.deepEqual(parseRoute("/books"), { page: "books" });
  assert.deepEqual(parseRoute("/products/moonlit-atlas"), {
    page: "product",
    id: "moonlit-atlas",
  });
  assert.deepEqual(parseRoute("/cart"), { page: "cart" });
  for (const value of [
    "https://other.example/cart",
    "//other.example/cart",
    "/cart#fragment",
    "/products/../cart",
    "garbage",
    "/unknown",
  ]) {
    assert.deepEqual(parseRoute(value), { page: "missing" }, value);
  }
});

test("links encode the complete route and registered plugin ID", () => {
  const link = new URL(
    pluginLink("bookshop@local", "/products/moonlit-atlas?from=cart")
  );
  assert.equal(link.pathname, "/plugins/bookshop%40local/app/open_bookshop");
  assert.equal(
    link.searchParams.get("path"),
    "/products/moonlit-atlas?from=cart"
  );
});
