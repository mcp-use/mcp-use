import { describe, it, expect, vi, beforeEach } from "vitest";
import { VMCodeExecutor } from "../../../src/client/codeExecutor.js";
import { MCPClient } from "../../../src/client.js";

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
