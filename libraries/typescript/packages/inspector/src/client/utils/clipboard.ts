/**
 * Copy text to clipboard with fallback for non-secure contexts (HTTP, iframes).
 * Uses navigator.clipboard when available, otherwise document.execCommand('copy').
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for non-secure contexts (HTTP, iframes without clipboard permission)
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  if (!document.execCommand("copy")) {
    throw new Error("execCommand copy failed");
  }
  document.body.removeChild(textarea);
}
