import { createLlmDriver } from "./driver.js";
import type { ProviderConfig, ProviderMessage } from "./types.js";

/** Single-shot chat completion without tools (sampling, props generation). */
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
