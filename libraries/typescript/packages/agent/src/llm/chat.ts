import { createLlmDriver } from "./driver.js";
import type { ProviderConfig, ProviderMessage } from "./types.js";

/**
 * Runs one provider chat completion without exposing tools.
 *
 * @param params - Provider configuration, messages, and optional cancellation
 * signal.
 * @returns The assistant's final text.
 * @throws {@link LlmRequestError} when the provider rejects the HTTP request.
 */
export async function completeChat(params: {
  config: ProviderConfig;
  messages: ProviderMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  const driver = createLlmDriver(params.config);
  const result = await driver.complete({
    messages: params.messages,
    tools: [],
    signal: params.signal,
  });
  return result.text;
}
