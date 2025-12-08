import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { VERSION } from "./version.js";

/**
 * Get the package version.
 * The version is embedded at build time via scripts/generate-version.mjs
 * Works in all environments (Node.js, browser, Cloudflare Workers, Deno, etc.)
 */
export function getPackageVersion(): string {
  return VERSION;
}

export function getModelProvider(llm: BaseLanguageModel): string {
  // Use LangChain's standard _llm_type property for identification
  return (llm as any)._llm_type || llm.constructor.name.toLowerCase();
}

export function getModelName(llm: BaseLanguageModel): string {
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

export function extractModelInfo(llm: BaseLanguageModel): [string, string] {
  return [getModelProvider(llm), getModelName(llm)];
}
