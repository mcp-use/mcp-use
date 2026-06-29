import type { BaseLanguageModel } from "@langchain/core/language_models/base";
export { getPackageVersion } from "../version.js";

type ModelInfoCarrier = BaseLanguageModel & {
  _llm_type?: unknown;
  _identifyingParams?: unknown;
  model?: unknown;
  modelName?: unknown;
};

function getModelProvider(llm: BaseLanguageModel): string {
  // Use LangChain's standard _llm_type property for identification
  const model = llm as ModelInfoCarrier;
  return typeof model._llm_type === "string" && model._llm_type.length > 0
    ? model._llm_type
    : llm.constructor.name.toLowerCase();
}

function getModelName(llm: BaseLanguageModel): string {
  // First try _identifying_params which may contain model info
  const model = llm as ModelInfoCarrier;
  if ("_identifyingParams" in model) {
    const identifyingParams = model._identifyingParams;
    if (
      typeof identifyingParams === "object" &&
      identifyingParams !== null &&
      !Array.isArray(identifyingParams)
    ) {
      const params = identifyingParams as Record<string, unknown>;
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
        if (key in params) {
          return String(params[key]);
        }
      }
    }
  }

  // Fallback to direct model attributes
  return typeof model.model === "string" && model.model.length > 0
    ? model.model
    : typeof model.modelName === "string" && model.modelName.length > 0
      ? model.modelName
      : llm.constructor.name;
}

export function extractModelInfo(llm: BaseLanguageModel): [string, string] {
  return [getModelProvider(llm), getModelName(llm)];
}
