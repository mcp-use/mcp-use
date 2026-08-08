/** Hero mesh palette — light landing surfaces. */
export const MESH_COLORS_LIGHT = [
  "#e0eaff",
  "#f9ffbd",
  "#dedede",
  "#ffffff",
] as const;

/** Dark mesh — yellow + zinc neutrals (no blue). */
export const MESH_COLORS_DARK = [
  "#27272a",
  "#9a9448",
  "#3f3f46",
  "#18181b",
] as const;

export function meshColorsForTheme(theme: "light" | "dark"): readonly string[] {
  return theme === "dark" ? MESH_COLORS_DARK : MESH_COLORS_LIGHT;
}
