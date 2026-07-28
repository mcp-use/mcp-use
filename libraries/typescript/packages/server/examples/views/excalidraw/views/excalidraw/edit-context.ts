const DEBOUNCE_MS = 2000;
let timer: ReturnType<typeof setTimeout> | null = null;
let initialSnapshot: string | null = null;
let initialElementsById: Map<string, Record<string, unknown>> = new Map();
let storageKey: string | null = null;
let checkpointId: string | null = null;

type SaveCheckpoint = (args: { id: string; data: string }) => Promise<unknown>;

let saveCheckpointFn: SaveCheckpoint | null = null;

/**
 * Set the localStorage key for this widget instance (use checkpointId).
 */
export function setStorageKey(key: string): void {
  storageKey = `excalidraw:${key}`;
}

/**
 * Set the checkpoint key for saving state snapshots.
 */
export function setCheckpointId(id: string): void {
  checkpointId = id;
}

/**
 * Wire the app-private `save_checkpoint` tool caller used by editor sync.
 */
export function setSaveCheckpoint(fn: SaveCheckpoint): void {
  saveCheckpointFn = fn;
}

/**
 * Call once after final render to capture the baseline element state.
 */
export function captureInitialElements(
  elements: readonly Record<string, unknown>[]
): void {
  initialSnapshot = JSON.stringify(
    elements.map((el) => `${el.id}:${(el.version as number | undefined) ?? 0}`)
  );
  initialElementsById = new Map(
    elements.map((el) => [String(el.id), el] as const)
  );
}

/** Compute a compact diff between initial and current elements. */
function computeDiff(current: Record<string, unknown>[]): string {
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const currentIds = new Set<string>();

  for (const el of current) {
    const id = String(el.id);
    currentIds.add(id);
    const orig = initialElementsById.get(id);
    if (!orig) {
      const label =
        (el.text as string | undefined) ??
        (el.label as { text?: string } | undefined)?.text ??
        "";
      const desc = `${el.type} "${label}" at (${Math.round(Number(el.x))},${Math.round(Number(el.y))})`;
      added.push(desc);
    } else if (
      Math.round(Number(orig.x)) !== Math.round(Number(el.x)) ||
      Math.round(Number(orig.y)) !== Math.round(Number(el.y)) ||
      Math.round(Number(orig.width)) !== Math.round(Number(el.width)) ||
      Math.round(Number(orig.height)) !== Math.round(Number(el.height))
    ) {
      moved.push(
        `${id} → (${Math.round(Number(el.x))},${Math.round(Number(el.y))}) ${Math.round(Number(el.width))}x${Math.round(Number(el.height))}`
      );
    }
  }

  for (const id of initialElementsById.keys()) {
    if (!currentIds.has(id)) removed.push(id);
  }

  const parts: string[] = [];
  if (added.length) parts.push(`Added: ${added.join("; ")}`);
  if (removed.length) parts.push(`Removed: ${removed.join(", ")}`);
  if (moved.length) parts.push(`Moved/resized: ${moved.join("; ")}`);
  if (!parts.length) return "";
  const cpRef = checkpointId ? ` (checkpoint: ${checkpointId})` : "";
  return `User edited diagram${cpRef}. ${parts.join(". ")}`;
}

/**
 * Load persisted elements from localStorage (if any).
 */
export function loadPersistedElements(): Record<string, unknown>[] | null {
  if (!storageKey) return null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;
    return JSON.parse(stored) as Record<string, unknown>[];
  } catch {
    return null;
  }
}

/** Latest edited elements (kept in sync without triggering React re-renders). */
let latestEditedElements: Record<string, unknown>[] | null = null;

/**
 * Get the latest user-edited elements (or null if no edits were made).
 */
export function getLatestEditedElements(): Record<string, unknown>[] | null {
  return latestEditedElements;
}

/**
 * Excalidraw onChange handler. Persists to localStorage, syncs checkpoint to
 * the server, and reports a compact edit summary to the owning React view.
 */
export function onEditorChange(
  elements: readonly Record<string, unknown>[],
  setEditSummary: (summary: string) => void
): void {
  const currentSnapshot = JSON.stringify(
    elements.map((el) => `${el.id}:${(el.version as number | undefined) ?? 0}`)
  );
  if (currentSnapshot === initialSnapshot) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    setEditSummary("");
    return;
  }

  const live = [...elements].filter((el) => !el.isDeleted);
  latestEditedElements = live;

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(live));
      } catch {
        // ignore quota errors
      }
    }
    if (checkpointId && saveCheckpointFn) {
      void saveCheckpointFn({
        id: checkpointId,
        data: JSON.stringify({ elements: live }),
      }).catch(() => {});
    }
    setEditSummary(computeDiff(live));
  }, DEBOUNCE_MS);
}
