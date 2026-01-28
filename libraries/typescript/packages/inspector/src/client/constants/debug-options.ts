/**
 * Debug and playground options constants
 */

/**
 * Comprehensive list of common locales for widget testing
 * Note: Intl API doesn't provide a built-in way to enumerate all supported locales
 * This list covers major languages and regional variants
 */
const COMMON_LOCALES = [
  // English variants
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-IN", label: "English (India)" },
  // Spanish variants
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "es-AR", label: "Spanish (Argentina)" },
  { value: "es-CO", label: "Spanish (Colombia)" },
  // French variants
  { value: "fr-FR", label: "French (France)" },
  { value: "fr-CA", label: "French (Canada)" },
  { value: "fr-BE", label: "French (Belgium)" },
  { value: "fr-CH", label: "French (Switzerland)" },
  // German variants
  { value: "de-DE", label: "German (Germany)" },
  { value: "de-AT", label: "German (Austria)" },
  { value: "de-CH", label: "German (Switzerland)" },
  // Portuguese variants
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "pt-PT", label: "Portuguese (Portugal)" },
  // Chinese variants
  { value: "zh-CN", label: "Chinese (Simplified, China)" },
  { value: "zh-TW", label: "Chinese (Traditional, Taiwan)" },
  { value: "zh-HK", label: "Chinese (Traditional, Hong Kong)" },
  // Other major languages
  { value: "ja-JP", label: "Japanese (Japan)" },
  { value: "ko-KR", label: "Korean (Korea)" },
  { value: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { value: "ar-EG", label: "Arabic (Egypt)" },
  { value: "hi-IN", label: "Hindi (India)" },
  { value: "ru-RU", label: "Russian (Russia)" },
  { value: "it-IT", label: "Italian (Italy)" },
  { value: "nl-NL", label: "Dutch (Netherlands)" },
  { value: "nl-BE", label: "Dutch (Belgium)" },
  { value: "pl-PL", label: "Polish (Poland)" },
  { value: "sv-SE", label: "Swedish (Sweden)" },
  { value: "no-NO", label: "Norwegian (Norway)" },
  { value: "da-DK", label: "Danish (Denmark)" },
  { value: "fi-FI", label: "Finnish (Finland)" },
  { value: "tr-TR", label: "Turkish (Turkey)" },
  { value: "el-GR", label: "Greek (Greece)" },
  { value: "cs-CZ", label: "Czech (Czech Republic)" },
  { value: "hu-HU", label: "Hungarian (Hungary)" },
  { value: "ro-RO", label: "Romanian (Romania)" },
  { value: "th-TH", label: "Thai (Thailand)" },
  { value: "vi-VN", label: "Vietnamese (Vietnam)" },
  { value: "id-ID", label: "Indonesian (Indonesia)" },
  { value: "ms-MY", label: "Malay (Malaysia)" },
  { value: "tl-PH", label: "Tagalog (Philippines)" },
  { value: "he-IL", label: "Hebrew (Israel)" },
  { value: "uk-UA", label: "Ukrainian (Ukraine)" },
  { value: "bg-BG", label: "Bulgarian (Bulgaria)" },
  { value: "hr-HR", label: "Croatian (Croatia)" },
  { value: "sk-SK", label: "Slovak (Slovakia)" },
  { value: "sl-SI", label: "Slovenian (Slovenia)" },
  { value: "sr-RS", label: "Serbian (Serbia)" },
  { value: "bn-BD", label: "Bengali (Bangladesh)" },
  { value: "ta-IN", label: "Tamil (India)" },
  { value: "te-IN", label: "Telugu (India)" },
  { value: "mr-IN", label: "Marathi (India)" },
  { value: "ur-PK", label: "Urdu (Pakistan)" },
  { value: "fa-IR", label: "Persian (Iran)" },
  { value: "sw-KE", label: "Swahili (Kenya)" },
];

export const LOCALE_OPTIONS = COMMON_LOCALES;

/**
 * Get all available timezone options from Intl API
 * Formats timezone identifiers into readable labels
 */
function getTimezoneOptions() {
  const timeZones = Intl.supportedValuesOf("timeZone");
  return timeZones.map((tz) => ({
    value: tz,
    label: tz.replace(/_/g, " "), // Replace underscores with spaces for readability
  }));
}

/**
 * Available timezone options for widget testing
 * Generated dynamically from Intl.supportedValuesOf("timeZone")
 */
export const TIMEZONE_OPTIONS = getTimezoneOptions();

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
