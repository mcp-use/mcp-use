const CUSTOM_PROPERTY_NAME = /^--[A-Za-z0-9_-]+$/;

export function applyHostStyleVariables(
  variables: Record<string, string | undefined> | undefined,
  root?: HTMLElement
): void {
  if (typeof document === "undefined" || !variables) return;

  const target = root ?? document.documentElement;

  for (const [name, value] of Object.entries(variables)) {
    if (value === undefined) continue;
    if (!CUSTOM_PROPERTY_NAME.test(name)) {
      continue;
    }

    target.style.setProperty(name, value);
  }
}
