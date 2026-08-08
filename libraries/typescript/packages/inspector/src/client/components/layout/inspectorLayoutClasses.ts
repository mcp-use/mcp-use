export function getInspectorBodyClassName(isSingleTab: boolean): string {
  return isSingleTab
    ? "flex flex-1 min-h-0"
    : "flex min-w-0 flex-1 min-h-0 overflow-hidden";
}

export function getInspectorHeaderClassName(embedded: boolean): string {
  return embedded
    ? "w-full min-w-0 shrink-0 overflow-hidden lg:hidden"
    : "w-full min-w-0 shrink-0 overflow-hidden";
}
