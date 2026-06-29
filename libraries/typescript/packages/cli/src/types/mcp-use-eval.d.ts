declare module "mcp-use/eval" {
  export type EvalRunner = "local" | "cloud" | "chatgpt";
  export type EvalStatus = "passed" | "failed" | "skipped";

  export interface EvalAssertionResult {
    assertion: unknown;
    passed: boolean;
    message?: string;
  }

  export interface EvalTestResult {
    name: string;
    type: "protocol" | "tool" | "conversation";
    status: EvalStatus;
    durationMs: number;
    actualStatus?: "ok" | "error";
    actualText?: string;
    error?: string;
    assertions: EvalAssertionResult[];
  }

  export interface EvalSpecResult {
    name: string;
    runner: EvalRunner;
    server?: string;
    status: EvalStatus;
    tests: EvalTestResult[];
    error?: string;
  }

  export interface EvalReport {
    apiVersion: "mcp-use.dev/eval-report/v1";
    runner: EvalRunner;
    status: EvalStatus;
    startedAt: string;
    endedAt: string;
    summary: {
      specs: number;
      tests: number;
      passed: number;
      failed: number;
      skipped: number;
    };
    specs: EvalSpecResult[];
    outputPath?: string;
  }

  export interface EvalSpec {
    apiVersion: "mcp-use.dev/eval/v1";
    name: string;
    runner: EvalRunner;
    server?: string;
    mcpServers?: Record<string, Record<string, unknown>>;
    tests: Array<{
      type: "protocol" | "tool" | "conversation";
      name: string;
      [key: string]: unknown;
    }>;
  }

  export function parseEvalSpec(input: unknown): EvalSpec;
  export function runEvalSpecs(
    specs: EvalSpec[],
    options?: {
      runner?: EvalRunner;
      outputPath?: string;
    }
  ): Promise<EvalReport>;
}
