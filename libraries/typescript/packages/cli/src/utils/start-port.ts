export function hasExplicitPortFlag(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--port" || arg.startsWith("--port="));
}

export function resolveStartPort(
  argv: readonly string[],
  optionPort: string | undefined,
  envPort: string | undefined
): number {
  const rawPort = hasExplicitPortFlag(argv)
    ? optionPort
    : envPort || optionPort || "3000";

  return parseInt(rawPort || "3000", 10);
}
