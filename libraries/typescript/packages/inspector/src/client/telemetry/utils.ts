export function getPackageVersion(): string {
  try {
    if (typeof window !== "undefined") {
      const runtimeVersion = (window as any).__INSPECTOR_VERSION__;
      if (runtimeVersion !== undefined) {
        return runtimeVersion;
      }
    }
    if (typeof __INSPECTOR_VERSION__ !== "undefined") {
      return __INSPECTOR_VERSION__;
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}
