function copyWithExecCommand(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

/** Sync copy — use inside click handlers to stay within user activation. */
export function copyToClipboardSync(text: string): boolean {
  return copyWithExecCommand(text);
}

export async function copyToClipboard(text: string): Promise<void> {
  // ponytail: execCommand first — avoids Chrome's clipboard permission prompt
  // that navigator.clipboard.writeText can show without a fresh user gesture.
  if (copyWithExecCommand(text)) return;
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  throw new Error("copy failed");
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "just now";
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}
