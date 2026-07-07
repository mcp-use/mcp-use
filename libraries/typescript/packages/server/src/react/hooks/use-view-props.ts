import { useView } from "./use-view.js";

/**
 * Escape hatch returning the same payload as {@link useView}.`props`.
 *
 * @example
 * ```tsx
 * const props = useViewProps();
 * if (props) {
 *   console.log(props);
 * }
 * ```
 */
export function useViewProps(): ReturnType<typeof useView>["props"] {
  return useView().props;
}
