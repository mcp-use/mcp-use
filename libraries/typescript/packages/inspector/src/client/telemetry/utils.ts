export function getPackageVersion(): string {
  try {
    // Use global variable injected at build time
    if (typeof __INSPECTOR_VERSION__ !== "undefined") {
      return __INSPECTOR_VERSION__;
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}
