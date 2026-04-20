globalThis.process = { env: { NODE_ENV: "production" } };
globalThis.window = {
  location: { origin: "http://localhost:3000" },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.document = {};
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};
import("/Users/et/Documents/Projects/mcp-use/mcp-use/libraries/typescript/packages/mcp-use/dist/src/browser.js")
  .then((m) => {
    if (!m.MCPClient) throw new Error("MCPClient not exported");
    if (typeof m.MCPClient !== "function")
      throw new Error("MCPClient is not a function");
    if (!m.Tel) throw new Error("Tel not exported");
    const tel = m.Tel.getInstance();
    if (!tel) throw new Error("Tel.getInstance() returned falsy");
    if (!m.logger) throw new Error("logger not exported");
    m.logger.info("Test log");
    const version = m.getPackageVersion();
    if (typeof version !== "string")
      throw new Error("getPackageVersion did not return string");
    console.log("__TEST_SUCCESS__");
  })
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  });
