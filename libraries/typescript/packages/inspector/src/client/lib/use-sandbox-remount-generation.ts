import { useCallback, useRef, useState } from "react";

/**
 * Tracks SandboxedIframe remounts so AppBridge can tear down and reconnect.
 * First mount does not increment; subsequent mounts (e.g. PiP portal) do.
 */
export function useSandboxRemountGeneration() {
  const [generation, setGeneration] = useState(0);
  const hasMountedOnceRef = useRef(false);

  const onSandboxMount = useCallback(() => {
    if (!hasMountedOnceRef.current) {
      hasMountedOnceRef.current = true;
      return false;
    }
    setGeneration((g) => g + 1);
    return true;
  }, []);

  return { sandboxGeneration: generation, onSandboxMount };
}
