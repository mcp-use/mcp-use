declare global {
  interface Window {
    __INSPECTOR_VERSION__?: string;
  }
}

export function getPackageVersion(): string {
  try {
    if (typeof window !== "undefined") {
      const version = window.__INSPECTOR_VERSION__;
      if (version !== undefined) {
        return version;
      }
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}
