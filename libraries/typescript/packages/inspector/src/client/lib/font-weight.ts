export const fontWeights = {
  normal: "'wght' 400, 'opsz' 14",
  medium: "'wght' 450, 'opsz' 15",
  semibold: "'wght' 550, 'opsz' 20",
  bold: "'wght' 700, 'opsz' 25",
} as const;

export const inspectorTabHeaderPadding = "px-4 pt-3 pb-3";
export const inspectorTabTitleClass =
  "text-[15px] text-foreground [font-variation-settings:'wght'_550,'opsz'_20]";

export function inspectorStickyTabHeaderClass(isScrolled: boolean): string {
  return `sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md transition-[border-color] duration-200 supports-[backdrop-filter]:bg-background/70 ${
    isScrolled ? "border-border/80" : "border-transparent"
  }`;
}
