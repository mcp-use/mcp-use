import { describe, it, expect, vi, beforeEach } from "vitest";
import { VMCodeExecutor } from "../../../src/code-mode/executor-vm.js";
import { MCPClient } from "../../../src/core/node.js";

describe("CodeExecutor", () => {
  let client: MCPClient;
  let executor: VMCodeExecutor;

  beforeEach(() => {
    client = new MCPClient();
    executor = new VMCodeExecutor(client);
  });

  it("executes simple code", async () => {
    const result = await executor.execute("return 1 + 1;");
    expect(result.result).toBe(2);
    expect(result.error).toBeNull();
  });

  it("captures logs", async () => {
    const result = await executor.execute(`
      console.log("Hello");
      console.log("World");
      return "done";
    `);
    expect(result.logs).toContain("Hello");
    expect(result.logs).toContain("World");
    expect(result.result).toBe("done");
  });

  it("logs the message of a caught error instead of {}", async () => {
    const result = await executor.execute(`
      try {
        throw new Error("Boom");
      } catch (e) {
        console.error(e);
        console.error({ error: e });
      }
      return "ok";
    `);
    expect(result.logs).toEqual([
      "[ERROR] Error: Boom",
      `[ERROR] ${JSON.stringify({ error: "Error: Boom" }, null, 2)}`,
    ]);
    expect(result.result).toBe("ok");
  });

  it("logs values JSON cannot represent without aborting the run", async () => {
    const result = await executor.execute(`
      const value = { id: 1n };
      value.self = value;
      console.log(value);
      return "ok";
    `);
    expect(result.error).toBeNull();
    expect(result.result).toBe("ok");
    expect(result.logs).toEqual([
      JSON.stringify({ id: "1n", self: "[Circular]" }, null, 2),
    ]);
  });

  it("logs values whose toString or getters throw without aborting the run", async () => {
    const result = await executor.execute(`
      const fn = () => {};
      fn.toString = () => { throw new Error("toString"); };
      const tagged = { get [Symbol.toStringTag]() { throw new Error("tag"); } };
      console.log(fn, tagged);
      return "ok";
    `);
    expect(result.error).toBeNull();
    expect(result.result).toBe("ok");
    expect(result.logs).toEqual([
      "[unserializable value] [unserializable value]",
    ]);
  });

  it("handles async code", async () => {
    const result = await executor.execute(`
      await new Promise(resolve => setTimeout(resolve, 10));
      return "async done";
    `);
    expect(result.result).toBe("async done");
  });

  it("handles errors", async () => {
    const result = await executor.execute("throw new Error('Boom');");
    expect(result.error).toBe("Boom");
  });

  it("prevents unsafe globals", async () => {
    const result = await executor.execute("return process;");
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("process is not defined");
  });
});
