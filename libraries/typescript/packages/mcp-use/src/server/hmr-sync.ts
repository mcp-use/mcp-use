/**
 * Generic HMR (Hot Module Replacement) synchronization for MCP primitives.
 * Handles tools, prompts, resources, and resource templates with consistent logic.
 */

/**
 * Normalize handler function to a comparable string
 */
export function normalizeHandler(handler: unknown): string {
  if (typeof handler === "function") {
    return handler.toString().replace(/\s+/g, " ").trim();
  }
  return String(handler);
}

/**
 * Registration entry with config and handler
 */
export interface Registration<TConfig, THandler> {
  config: TConfig;
  handler: THandler;
}

/**
 * Registered reference that can be updated or removed
 */
export interface RegisteredRef {
  update?: (updates: any) => void;
  remove: () => void;
}

/**
 * Session context for HMR operations
 */
export interface SessionContext {
  sessionId: string;
  /** Get the refs map for this primitive type */
  getRefs: () => Map<string, any> | undefined;
  /** Register a new item on this session, returns the ref */
  register: (name: string, config: unknown, handler: unknown) => any | null;
}

/**
 * Changes detected during sync
 */
export interface SyncChanges {
  added: string[];
  removed: string[];
  updated: string[];
}

/**
 * Options for syncing a primitive type
 */
export interface SyncOptions<TConfig, THandler> {
  /** Name of the primitive type for logging */
  primitiveName: string;
  /** Current registrations map */
  currentRegistrations: Map<string, Registration<TConfig, THandler>>;
  /** New registrations map from reloaded module */
  newRegistrations: Map<string, Registration<TConfig, THandler>>;
  /** Session contexts for injecting into active sessions */
  sessions: SessionContext[];
  /** Whether this primitive supports in-place updates via ref.update() */
  supportsInPlaceUpdate?: boolean;
  /** Custom key extractor (defaults to using the map key) */
  getKey?: (name: string, reg: Registration<TConfig, THandler>) => string;
  /** Custom rename handler for primitives that need order-preserving renames (e.g., tools) */
  onRename?: (
    session: SessionContext,
    oldKey: string,
    newKey: string,
    newConfig: TConfig,
    newHandler: THandler
  ) => void;
  /** Custom update handler for primitives that need order-preserving updates (e.g., tools) */
  onUpdate?: (
    session: SessionContext,
    key: string,
    newConfig: TConfig,
    newHandler: THandler
  ) => void;
}

/**
 * Result of syncing a primitive type
 */
export interface SyncResult<TConfig, THandler> {
  changes: SyncChanges;
  updatedRegistrations: Map<string, Registration<TConfig, THandler>>;
}

/**
 * Generic sync function for any MCP primitive type.
 * Handles rename detection, updates, additions, and session injection.
 */
export function syncPrimitive<TConfig, THandler>(
  options: SyncOptions<TConfig, THandler>
): SyncResult<TConfig, THandler> {
  const {
    primitiveName,
    currentRegistrations,
    newRegistrations,
    sessions,
    supportsInPlaceUpdate = false,
    getKey: _getKey = (name) => name,
    onRename,
    onUpdate,
  } = options;

  const changes: SyncChanges = {
    added: [],
    removed: [],
    updated: [],
  };

  // Build sets of keys
  const oldKeys = new Set(currentRegistrations.keys());
  const newKeys = new Set(newRegistrations.keys());

  // Detect potential renames
  const potentiallyRemoved = [...oldKeys].filter((k) => !newKeys.has(k));
  const potentiallyAdded = [...newKeys].filter((k) => !oldKeys.has(k));

  // Build handler -> old key map for rename detection
  const oldHandlerToKey = new Map<string, string>();
  for (const oldKey of potentiallyRemoved) {
    const oldReg = currentRegistrations.get(oldKey);
    if (oldReg) {
      oldHandlerToKey.set(normalizeHandler(oldReg.handler), oldKey);
    }
  }

  // Detect renames: new items whose handlers match old items
  const renames = new Map<string, string>(); // newKey -> oldKey
  for (const newKey of potentiallyAdded) {
    const newReg = newRegistrations.get(newKey);
    if (newReg) {
      const normalized = normalizeHandler(newReg.handler);
      const oldKey = oldHandlerToKey.get(normalized);
      if (oldKey) {
        renames.set(newKey, oldKey);
      }
    }
  }

  // Start with current registrations to preserve order
  const updatedRegistrations = new Map(currentRegistrations);

  // Handle renames (order-preserving replacement)
  for (const [newKey, oldKey] of renames) {
    const newReg = newRegistrations.get(newKey)!;

    // Rebuild map to preserve order
    const rebuiltMap = new Map<string, Registration<TConfig, THandler>>();
    for (const [key, value] of updatedRegistrations) {
      if (key === oldKey) {
        rebuiltMap.set(newKey, newReg);
      } else {
        rebuiltMap.set(key, value);
      }
    }
    updatedRegistrations.clear();
    for (const [k, v] of rebuiltMap) {
      updatedRegistrations.set(k, v);
    }

    // Update active sessions with order-preserving rename
    for (const session of sessions) {
      try {
        if (onRename) {
          // Use custom rename handler for order preservation
          onRename(session, oldKey, newKey, newReg.config, newReg.handler);
        } else {
          // Default: remove old and register new (doesn't preserve order)
          const refs = session.getRefs();
          const oldRef = refs?.get(oldKey);

          if (oldRef) {
            oldRef.remove();
            refs?.delete(oldKey);
          }

          const newRef = session.register(
            newKey,
            newReg.config,
            newReg.handler
          );
          if (refs && newRef) {
            refs.set(newKey, newRef);
          }
        }
      } catch (error) {
        console.error(
          `[HMR] Failed to rename ${primitiveName} "${oldKey}" to "${newKey}" in session ${session.sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    changes.removed.push(`${oldKey} (renamed to ${newKey})`);
    changes.added.push(newKey);

    // Remove from potentiallyAdded so we don't process again
    const idx = potentiallyAdded.indexOf(newKey);
    if (idx !== -1) potentiallyAdded.splice(idx, 1);
  }

  // Handle truly removed items (not renames)
  const trulyRemoved = potentiallyRemoved.filter(
    (oldKey) => !Array.from(renames.values()).includes(oldKey)
  );

  for (const removedKey of trulyRemoved) {
    // Remove from updatedRegistrations
    updatedRegistrations.delete(removedKey);

    // Remove from active sessions
    for (const session of sessions) {
      try {
        const refs = session.getRefs();
        const oldRef = refs?.get(removedKey);

        if (oldRef) {
          oldRef.remove();
          refs?.delete(removedKey);
        }
      } catch (error) {
        console.error(
          `[HMR] Failed to remove ${primitiveName} "${removedKey}" in session ${session.sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    changes.removed.push(removedKey);
  }

  // Handle truly new items
  for (const newKey of potentiallyAdded) {
    const newReg = newRegistrations.get(newKey)!;
    updatedRegistrations.set(newKey, newReg);

    // Inject into active sessions
    for (const session of sessions) {
      try {
        const newRef = session.register(newKey, newReg.config, newReg.handler);
        const refs = session.getRefs();
        if (refs && newRef) {
          refs.set(newKey, newRef);
        }
      } catch (error) {
        console.error(
          `[HMR] Failed to add ${primitiveName} "${newKey}" in session ${session.sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    changes.added.push(newKey);
  }

  // Handle updates to existing items
  for (const key of newKeys) {
    // Skip renamed items
    if (renames.has(key)) continue;
    // Skip new items (already handled)
    if (!oldKeys.has(key)) continue;

    const oldReg = currentRegistrations.get(key)!;
    const newReg = newRegistrations.get(key)!;

    const configChanged =
      JSON.stringify(oldReg.config) !== JSON.stringify(newReg.config);
    const handlerChanged =
      normalizeHandler(oldReg.handler) !== normalizeHandler(newReg.handler);

    if (configChanged || handlerChanged) {
      updatedRegistrations.set(key, newReg);

      // Update active sessions
      for (const session of sessions) {
        try {
          const refs = session.getRefs();
          const existingRef = refs?.get(key);

          if (onUpdate) {
            // Use custom order-preserving update handler
            // This is preferred over in-place update because it properly handles
            // handler wrapping (e.g., prompt conversion) and config updates
            onUpdate(session, key, newReg.config, newReg.handler);
          } else if (
            supportsInPlaceUpdate &&
            existingRef?.update &&
            !configChanged
          ) {
            // In-place update (only handler changed)
            // Only use this path if no custom onUpdate handler is provided
            existingRef.update(newReg.handler);
          } else {
            // Full re-registration needed (doesn't preserve order)
            if (existingRef) {
              existingRef.remove();
              refs?.delete(key);
            }
            const newRef = session.register(key, newReg.config, newReg.handler);
            if (refs && newRef) {
              refs.set(key, newRef);
            }
          }
        } catch (error) {
          console.error(
            `[HMR] Failed to update ${primitiveName} "${key}" in session ${session.sessionId}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      changes.updated.push(key);
    }
  }

  return { changes, updatedRegistrations };
}

/**
 * Log changes for a primitive type
 */
export function logChanges(primitiveName: string, changes: SyncChanges): void {
  if (changes.added.length) {
    console.log(`  + ${primitiveName}: ${changes.added.join(", ")}`);
  }
  if (changes.removed.length) {
    console.log(`  - ${primitiveName}: ${changes.removed.join(", ")}`);
  }
  if (changes.updated.length) {
    console.log(`  ~ ${primitiveName}: ${changes.updated.join(", ")}`);
  }
}

/**
 * Count total changes across all primitives
 */
export function countChanges(...allChanges: SyncChanges[]): number {
  return allChanges.reduce(
    (total, changes) =>
      total +
      changes.added.length +
      changes.removed.length +
      changes.updated.length,
    0
  );
}
