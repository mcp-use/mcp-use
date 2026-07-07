import { useState } from "react";

/**
 * Local UI state for the iframe lifetime only.
 *
 * @remarks Unlike v1's `useWidgetState`, this state is **not** persisted by the
 * host and is **not** model-visible. Use {@link ModelContext} for explicit
 * model visibility.
 *
 * @example
 * ```tsx
 * const [favorites, setFavorites] = useViewState<string[]>([]);
 * ```
 */
export function useViewState<T>(
  initial: T
): [T, (next: T) => void] {
  const [state, setState] = useState<T>(initial);
  return [state, setState];
}
