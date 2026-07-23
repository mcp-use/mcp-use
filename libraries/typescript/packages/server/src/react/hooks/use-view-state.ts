import {
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";

/**
 * Persist model-visible state for the current mounted view.
 *
 * Every component in one view runtime reads and updates the same state object.
 * ChatGPT restores the object from `window.openai.widgetState.modelContent`.
 * Other MCP Apps hosts keep it for the iframe lifetime and receive it through
 * `ui/update-model-context`.
 *
 * The state must be a JSON-serializable object and cannot contain the reserved
 * `_uiContext` key used by {@link ModelContext}.
 *
 * @param defaultState - Initial object, or a lazy initializer evaluated once
 * for this hook instance. Restored ChatGPT state takes precedence.
 * @returns A readonly `[state, setState]` tuple with `useState` ergonomics.
 *
 * @example
 * ```tsx
 * const [state, setState] = useViewState({ count: 0 });
 * setState((previous) => ({ ...previous, count: previous.count + 1 }));
 * ```
 */
export function useViewState<T extends Record<string, unknown>>(
  defaultState: T | (() => T)
): readonly [T, (state: SetStateAction<T>) => void] {
  const runtime = useViewRuntime("useViewState");
  const store = runtime.modelContextStore;
  const defaultRef = useRef<T | null>(null);

  if (defaultRef.current === null) {
    defaultRef.current =
      typeof defaultState === "function"
        ? (defaultState as () => T)()
        : defaultState;
  }

  const storedState = useSyncExternalStore(
    store.subscribeViewState,
    store.getViewStateSnapshot
  ) as T | null;

  useEffect(() => {
    store.initializeViewState(defaultRef.current as T);
  }, [store]);

  const setViewState = useCallback(
    (action: SetStateAction<T>): void => {
      store.updateViewState((previous) => {
        const current = (previous ?? defaultRef.current) as T;
        return typeof action === "function"
          ? (action as (previousState: T) => T)(current)
          : action;
      });
    },
    [store]
  );

  return [(storedState ?? defaultRef.current) as T, setViewState] as const;
}
