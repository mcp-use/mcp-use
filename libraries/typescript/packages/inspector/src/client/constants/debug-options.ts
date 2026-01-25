/**
 * Debug and playground options constants
 */

/**
 * Available locale options for widget testing
 */
export const LOCALE_OPTIONS = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (GB)" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "fr-FR", label: "French (France)" },
  { value: "de-DE", label: "German (Germany)" },
  { value: "ja-JP", label: "Japanese (Japan)" },
] as const;

/**
 * Available timezone options for widget testing
 */
export const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "New York" },
  { value: "America/Los_Angeles", label: "Los Angeles" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const;

/**
 * CSP mode options with descriptions
 */
export const CSP_MODE_OPTIONS = [
  {
    value: "strict" as const,
    label: "Strict",
    description: "Enforce CSP as specified by widget",
  },
  {
    value: "permissive" as const,
    label: "Permissive",
    description: "Relaxed CSP for development",
  },
] as const;
