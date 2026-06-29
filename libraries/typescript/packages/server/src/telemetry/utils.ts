export { getPackageVersion } from "@mcp-use/core";

function getModelProvider(llm: any): string {
  // Use LangChain's standard _llm_type property for identification
  return (llm as any)._llm_type || llm.constructor.name.toLowerCase();
}

function getModelName(llm: any): string {
  // First try _identifying_params which may contain model info
  if ("_identifyingParams" in llm) {
    const identifyingParams = (llm as any)._identifyingParams;
    if (typeof identifyingParams === "object" && identifyingParams !== null) {
      // Common keys that contain model names
      for (const key of [
        "model",
        "modelName",
        "model_name",
        "modelId",
        "model_id",
        "deploymentName",
        "deployment_name",
      ]) {
        if (key in identifyingParams) {
          return String(identifyingParams[key]);
        }
      }
    }
  }

  // Fallback to direct model attributes
  return (llm as any).model || (llm as any).modelName || llm.constructor.name;
}

export function extractModelInfo(llm: any): [string, string] {
  return [getModelProvider(llm), getModelName(llm)];
}
