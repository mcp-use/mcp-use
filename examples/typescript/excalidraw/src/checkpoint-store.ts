import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Maximum serialized checkpoint size (5 MB). */
const MAX_CHECKPOINT_BYTES = 5 * 1024 * 1024;

/** Maximum number of checkpoints kept on disk before pruning oldest. */
const MAX_FILE_CHECKPOINTS = 100;

/**
 * Validates that a checkpoint ID is safe to use as a filename.
 * Rejects path traversal attempts and other filesystem-unsafe characters.
 */
function validateCheckpointId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(
      `Invalid checkpoint id: must be alphanumeric, hyphens, or underscores`
    );
  }
  if (id.length > 64) {
    throw new Error(`Invalid checkpoint id: exceeds 64 character limit`);
  }
}

export interface CheckpointStore {
  save(id: string, data: { elements: unknown[] }): Promise<void>;
  load(id: string): Promise<{ elements: unknown[] } | null>;
}

/** Local-dev checkpoint store under `$TMPDIR/excalidraw-mcp-checkpoints/`. */
export class FileCheckpointStore implements CheckpointStore {
  private dir: string;
  constructor() {
    this.dir = path.join(os.tmpdir(), "excalidraw-mcp-checkpoints");
    fs.mkdirSync(this.dir, { recursive: true });
  }
  async save(id: string, data: { elements: unknown[] }): Promise<void> {
    validateCheckpointId(id);
    const serialized = JSON.stringify(data);
    if (serialized.length > MAX_CHECKPOINT_BYTES) {
      throw new Error(
        `Checkpoint data exceeds ${MAX_CHECKPOINT_BYTES} byte limit`
      );
    }
    const filePath = path.join(this.dir, `${id}.json`);
    if (!path.resolve(filePath).startsWith(path.resolve(this.dir) + path.sep)) {
      throw new Error("Invalid checkpoint path");
    }
    await fs.promises.writeFile(filePath, serialized);
    await this.pruneOldCheckpoints();
  }
  async load(id: string): Promise<{ elements: unknown[] } | null> {
    validateCheckpointId(id);
    const filePath = path.join(this.dir, `${id}.json`);
    if (!path.resolve(filePath).startsWith(path.resolve(this.dir) + path.sep)) {
      throw new Error("Invalid checkpoint path");
    }
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(raw) as { elements: unknown[] };
    } catch {
      return null;
    }
  }
  private async pruneOldCheckpoints(): Promise<void> {
    try {
      const entries = await fs.promises.readdir(this.dir);
      const jsonFiles = entries.filter((f) => f.endsWith(".json"));
      if (jsonFiles.length <= MAX_FILE_CHECKPOINTS) return;

      const stats = await Promise.all(
        jsonFiles.map(async (f) => ({
          name: f,
          mtime: (await fs.promises.stat(path.join(this.dir, f))).mtimeMs,
        }))
      );
      stats.sort((a, b) => a.mtime - b.mtime);
      const toRemove = stats.slice(0, stats.length - MAX_FILE_CHECKPOINTS);
      await Promise.all(
        toRemove.map((f) =>
          fs.promises.unlink(path.join(this.dir, f.name)).catch(() => {})
        )
      );
    } catch {
      // Best-effort cleanup; don't fail the save
    }
  }
}

const memoryStore = new Map<string, string>();

/** In-memory fallback store (lost on process restart). */
export class MemoryCheckpointStore implements CheckpointStore {
  async save(id: string, data: { elements: unknown[] }): Promise<void> {
    validateCheckpointId(id);
    const serialized = JSON.stringify(data);
    if (serialized.length > MAX_CHECKPOINT_BYTES) {
      throw new Error(
        `Checkpoint data exceeds ${MAX_CHECKPOINT_BYTES} byte limit`
      );
    }
    memoryStore.set(id, serialized);
    if (memoryStore.size > MAX_FILE_CHECKPOINTS) {
      const oldest = memoryStore.keys().next().value;
      if (oldest !== undefined) memoryStore.delete(oldest);
    }
  }
  async load(id: string): Promise<{ elements: unknown[] } | null> {
    validateCheckpointId(id);
    const raw = memoryStore.get(id);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { elements: unknown[] };
    } catch {
      return null;
    }
  }
}
