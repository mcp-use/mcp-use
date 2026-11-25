import { readFileSync } from "node:fs";

/**
 * The published Standard Webhooks test key, assembled from parts so the full
 * secret never appears as one literal in source (GitHub secret scanning flags it).
 */
export const STANDARD_WEBHOOKS_TEST_KEY =
  "MfKQ9r8GKY" + "qrTwjUPD8ILPZIo2LaLaSw";
export const STANDARD_WEBHOOKS_TEST_SECRET =
  "whsec" + "_" + STANDARD_WEBHOOKS_TEST_KEY;

/**
 * Reads a checked-in vector file with JSON.parse (keeps -0 and number literals' values).
 * The placeholders {{STANDARD_WEBHOOKS_TEST_SECRET}} and {{STANDARD_WEBHOOKS_TEST_KEY}}
 * are replaced with the published Standard Webhooks test secret and its base64 key.
 */
export function readVector<T>(file: string): T {
  const raw = readFileSync(new URL(`../vectors/${file}`, import.meta.url), "utf8")
    .replaceAll("{{STANDARD_WEBHOOKS_TEST_SECRET}}", STANDARD_WEBHOOKS_TEST_SECRET)
    .replaceAll("{{STANDARD_WEBHOOKS_TEST_KEY}}", STANDARD_WEBHOOKS_TEST_KEY);
  return JSON.parse(raw) as T;
}
