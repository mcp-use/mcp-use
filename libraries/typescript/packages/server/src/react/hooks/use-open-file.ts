import { useCallback } from "react";
import { useViewRuntime } from "../runtime/view-runtime-context.js";

/**
 * Ask the host to open a server-provided absolute execution-host file path.
 *
 * Requires the independent `openai/files` experimental capability. Unsupported
 * hosts and request failures reject. The host resolves the path and chooses the
 * viewer; success does not promise a particular viewer or tab layout.
 * Pass a path returned by a server tool, rather than a resource URI or download
 * URL. The SDK checks non-blank input without guessing the host's operating system.
 *
 * @returns A stable open callback for the mounted runtime.
 */
export function useOpenFile(): (args: { path: string }) => Promise<void> {
  const runtime = useViewRuntime();
  return useCallback(
    async (args: { path: string }) => {
      await runtime.openFile(args);
    },
    [runtime]
  );
}
