export interface TestMatrixConfig {
  inspectorMode: "dev" | "production";
  serverMode: "external-built" | "builtin-dev" | "remote";
  supportsHMR: boolean;
  supportsFileModification: boolean;
  inspectorUrl: string;
  serverUrl: string;
  usesBuiltinInspector: boolean;
}

export function getTestMatrix(): TestMatrixConfig {
  const inspectorMode = (process.env.TEST_MODE || "dev") as
    | "dev"
    | "production";
  const serverMode = (process.env.TEST_SERVER_MODE || "external-built") as
    | "external-built"
    | "builtin-dev"
    | "remote";

  const usesBuiltinInspector = serverMode === "builtin-dev";
  const inspectorUrl = usesBuiltinInspector
    ? "http://localhost:3000/inspector"
    : "http://localhost:3000/inspector";

  const serverUrl = (() => {
    if (process.env.TEST_SERVER_URL) return process.env.TEST_SERVER_URL;
    return usesBuiltinInspector
      ? "http://localhost:3000/mcp"
      : "http://localhost:3002/mcp";
  })();

  return {
    inspectorMode,
    serverMode,
    supportsHMR: serverMode === "builtin-dev",
    supportsFileModification: serverMode !== "remote",
    inspectorUrl,
    serverUrl,
    usesBuiltinInspector,
  };
}

export function skipIfNotSupported(requirement: "hmr" | "fileModification") {
  const matrix = getTestMatrix();

  if (requirement === "hmr" && !matrix.supportsHMR) {
    return "HMR requires server dev mode with builtin inspector (TEST_SERVER_MODE=builtin-dev)";
  }

  if (requirement === "fileModification" && !matrix.supportsFileModification) {
    return "File modification requires local server";
  }

  return false;
}
