import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EvalConfigError } from "../shared/errors.js";
import { runGenerate } from "./generate.js";
import { CliExitError } from "../shared/errors.js";

const inspectServersMock = vi.fn();
const planTestsMock = vi.fn();
const selectServersMock = vi.fn();
const selectToolsMock = vi.fn();
const selectResourcesMock = vi.fn();
const selectPlanActionMock = vi.fn();
const selectOutputFormatMock = vi.fn();

vi.mock("../generator/inspectServers.js", () => ({
  inspectServers: (...args: any[]) => inspectServersMock(...args),
}));

vi.mock("../generator/planTests.js", () => ({
  planTests: (...args: any[]) => planTestsMock(...args),
}));

vi.mock("./prompts.js", () => ({
  selectServers: (...args: any[]) => selectServersMock(...args),
  selectTools: (...args: any[]) => selectToolsMock(...args),
  selectResources: (...args: any[]) => selectResourcesMock(...args),
  selectPlanAction: (...args: any[]) => selectPlanActionMock(...args),
  selectOutputFormat: (...args: any[]) => selectOutputFormatMock(...args),
}));

describe("runGenerate", () => {
  const stderrSpy = vi.spyOn(process.stderr, "write");
  const stdoutSpy = vi.spyOn(process.stdout, "write");

  beforeEach(() => {
    inspectServersMock.mockReset();
    planTestsMock.mockReset();
    selectServersMock.mockReset();
    selectToolsMock.mockReset();
    selectResourcesMock.mockReset();
    selectPlanActionMock.mockReset();
    selectOutputFormatMock.mockReset();
    stderrSpy.mockClear();
    stdoutSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws exit code 2 on config errors", async () => {
    inspectServersMock.mockRejectedValueOnce(
      new EvalConfigError("bad config")
    );

    await expect(
      runGenerate({ planner: "openai:gpt-4o-mini", config: "bad.json" })
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  it("writes generated code to stdout when selected", async () => {
    inspectServersMock.mockResolvedValueOnce([
      { name: "simple", tools: [{ name: "add", description: "", inputSchema: { type: "object", properties: {} } }], resources: [] },
    ]);
    selectServersMock.mockResolvedValueOnce(["simple"]);
    selectToolsMock.mockResolvedValueOnce(["add"]);
    selectResourcesMock.mockResolvedValueOnce([]);
    selectPlanActionMock.mockResolvedValueOnce("yes");
    selectOutputFormatMock.mockResolvedValueOnce("stdout");
    planTestsMock.mockResolvedValueOnce([
      {
        server: "simple",
        tools: [
          { name: "add", description: "", tests: [{ category: "direct", prompt: "Add 1 and 2" }] },
        ],
        resources: [],
      },
    ]);

    await runGenerate({
      planner: "openai:gpt-4o-mini",
      config: "eval.config.json",
      output: "simple.eval.ts",
    });

    expect(stdoutSpy).toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });
});
