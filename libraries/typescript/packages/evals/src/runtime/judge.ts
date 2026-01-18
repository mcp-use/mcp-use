import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { statSync } from "node:fs";
import { EvalConfigError } from "../shared/errors.js";
import { loadEvalConfig } from "./loadEvalConfig.js";

/**
 * Result from a judge evaluation comparing actual vs expected text.
 */
export interface JudgeResult {
  /** Similarity score between 0.0 (no match) and 1.0 (perfect match) */
  score: number;
  /** Explanation of the score and key differences/similarities */
  reasoning: string;
}

/**
 * System prompt for the judge LLM.
 * Instructs the model to evaluate semantic similarity between actual and expected text.
 * @internal
 */
const JUDGE_SYSTEM_PROMPT = `
You are an evaluation judge comparing two pieces of text for semantic similarity.

Given:
1. ACTUAL: The text to evaluate
2. EXPECTED: The expected/reference text

Score the similarity from 0.0 to 1.0:
- 1.0: Perfect semantic match (same meaning, may differ in phrasing)
- 0.7-0.9: High similarity (core meaning matches, minor details differ)
- 0.4-0.6: Partial match (some overlap but significant differences)
- 0.1-0.3: Low similarity (tangentially related)
- 0.0: No similarity (completely different meaning)

Respond in JSON format:
{
  "score": <number between 0 and 1>,
  "reasoning": "<brief explanation>"
}
`;

/** Cached judge model to avoid recreating on every call */
let cachedModel: ChatOpenAI | ChatAnthropic | null = null;
/** Path of the config file used for the cached model */
let cachedConfigPath: string | null = null;
/** Modification time of the cached config file */
let cachedConfigMtime: number | null = null;

/**
 * Parse judge response from LLM output.
 * Extracts JSON object containing score and reasoning from response text.
 *
 * @param content - Raw response content from judge LLM
 * @returns Parsed JudgeResult with score and reasoning
 * @throws {Error} If response doesn't contain valid JSON or score is invalid
 *
 * @example
 * ```typescript
 * const content = '{"score": 0.85, "reasoning": "High similarity"}';
 * const result = parseJudgeResponse(content);
 * // result.score === 0.85
 * ```
 */
export function parseJudgeResponse(content: string): JudgeResult {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Judge did not return valid JSON");
  }
  const parsed = JSON.parse(match[0]);
  const score = Number(parsed.score);
  if (!Number.isFinite(score)) {
    throw new Error("Invalid judge score: must be a finite number");
  }
  if (score < 0 || score > 1) {
    throw new Error("Invalid judge score: must be between 0 and 1");
  }
  return {
    score,
    reasoning: String(parsed.reasoning ?? ""),
  };
}

/**
 * Get or create a cached judge model instance.
 * Caches the model to avoid recreation overhead and automatically invalidates
 * cache when config file changes.
 *
 * @param configPath - Optional path to eval config file
 * @returns Configured LangChain chat model for judging
 * @throws {EvalConfigError} If judge agent not found or invalid provider
 * @internal
 */
async function getJudgeModel(configPath?: string) {
  const resolvedPath = configPath ?? "";

  // Check if we have a valid cached model
  if (cachedModel && cachedConfigPath === resolvedPath) {
    // Check if config file has changed
    if (resolvedPath) {
      try {
        const stats = statSync(resolvedPath);
        const currentMtime = stats.mtimeMs;
        if (cachedConfigMtime !== null && cachedConfigMtime === currentMtime) {
          return cachedModel;
        }
      } catch {
        // File doesn't exist or can't be read, invalidate cache
        cachedModel = null;
        cachedConfigPath = null;
        cachedConfigMtime = null;
      }
    } else {
      // No config path specified, cache is still valid
      return cachedModel;
    }
  }

  const config = await loadEvalConfig(configPath);
  const judgeKey = config.default.judgeAgent;
  const agentConfig = config.agents[judgeKey];
  if (!agentConfig) {
    throw new EvalConfigError(`Judge agent "${judgeKey}" not found in config`);
  }

  // Double-check that path hasn't changed during async load
  if (cachedConfigPath === resolvedPath && cachedModel) {
    return cachedModel;
  }

  if (agentConfig.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new EvalConfigError("OPENAI_API_KEY is required for judge");
    }
    cachedModel = new ChatOpenAI({
      model: agentConfig.model,
      openAIApiKey: apiKey,
      configuration: agentConfig.baseUrl
        ? { baseURL: agentConfig.baseUrl }
        : undefined,
      temperature: 0,
    });
  } else if (agentConfig.provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new EvalConfigError("ANTHROPIC_API_KEY is required for judge");
    }
    cachedModel = new ChatAnthropic({
      model: agentConfig.model,
      anthropicApiKey: apiKey,
      temperature: 0,
    });
  } else {
    throw new EvalConfigError(
      `Unsupported judge provider: ${agentConfig.provider}`
    );
  }

  cachedConfigPath = resolvedPath;

  // Store mtime for cache invalidation
  if (resolvedPath) {
    try {
      const stats = statSync(resolvedPath);
      cachedConfigMtime = stats.mtimeMs;
    } catch {
      cachedConfigMtime = null;
    }
  } else {
    cachedConfigMtime = null;
  }

  return cachedModel;
}

/**
 * Evaluate semantic similarity between actual and expected text using an LLM judge.
 *
 * Uses a configured LLM (from eval config) to score how well the actual text
 * matches the expected text semantically. Returns a score from 0.0 to 1.0 along
 * with reasoning for the score.
 *
 * The judge is model-agnostic and uses zero-temperature for consistent scoring.
 *
 * @param actual - The text to evaluate (e.g., agent output)
 * @param expected - The expected/reference text
 * @param options - Optional configuration
 * @param options.configPath - Path to eval config file (defaults to eval.config.json)
 * @returns JudgeResult with similarity score and reasoning
 * @throws {EvalConfigError} If judge configuration is invalid
 *
 * @example
 * ```typescript
 * const result = await judge(
 *   "The weather is sunny with 72 degrees",
 *   "It's sunny and 72°F"
 * );
 *
 * if (result.score > 0.8) {
 *   console.log("High similarity:", result.reasoning);
 * }
 * ```
 */
export async function judge(
  actual: string,
  expected: string,
  options: { configPath?: string } = {}
): Promise<JudgeResult> {
  const llm = await getJudgeModel(options.configPath);
  const response = await llm.invoke([
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `ACTUAL:\n${actual}\n\nEXPECTED:\n${expected}`,
    },
  ]);

  return parseJudgeResponse(String(response.content ?? ""));
}
