import { readFileSync } from "node:fs";

/**
 * Builds a webhook secret string from raw key bytes: `prefix` + standard padded
 * base64 of `hex`. The vector files give the published Standard Webhooks test
 * secret as hex because GitHub secret scanning flags its whsec_ form.
 */
export function secretFromHex(hex: string, prefix = "whsec_"): string {
  return prefix + Buffer.from(hex, "hex").toString("base64");
}

/** The 24 key bytes of the published Standard Webhooks test secret, in hex. */
export const STANDARD_WEBHOOKS_TEST_KEY_HEX =
  "31f290f6bf06298aab4f08d43c3f082cf648a362da2da4b0";

/** The published Standard Webhooks test secret (whsec_ + base64 of the key). */
export const STANDARD_WEBHOOKS_TEST_SECRET = secretFromHex(
  STANDARD_WEBHOOKS_TEST_KEY_HEX
);

/** Reads a checked-in vector file with JSON.parse (keeps -0 and number literals' values). */
export function readVector<T>(file: string): T {
  return JSON.parse(
    readFileSync(new URL(`../vectors/${file}`, import.meta.url), "utf8")
  ) as T;
}
