import type {
  ExecFileOptions,
  execFileSync as nodeExecFileSync,
} from "node:child_process";
export function runProcess(
  file: string,
  args: readonly string[],
  options?: Omit<ExecFileOptions, "encoding">
): Promise<{ stdout: string; stderr: string }>;
export const execFileSync: typeof nodeExecFileSync;
