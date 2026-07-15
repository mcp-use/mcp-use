import { Check, Copy } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  generatePythonSDKCode,
  generateTypeScriptSDKCode,
} from "@/client/utils/mcpClientUtils";
import { copyToClipboard } from "@/client/utils/browser";
import { Button } from "./ui/button";

interface SdkIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverUrl: string;
  serverName: string;
  serverId?: string;
  headers?: Record<string, string>;
  language: "typescript" | "python";
}

/**
 * Render a modal that displays SDK integration code and copy/install instructions for a server.
 *
 * @param open - Whether the modal is visible
 * @param onOpenChange - Callback invoked with the new open state when the modal is opened or closed
 * @param serverUrl - Base URL of the server to integrate
 * @param serverName - Display name of the server used in the generated code and UI
 * @param serverId - Optional server identifier included in the generated code
 * @param headers - Optional additional request headers to include in the generated code
 * @param language - Target SDK language, either `"typescript"` or `"python"`
 * @returns A React element rendering the SDK integration modal
 */
export function SdkIntegrationModal({
  open,
  onOpenChange,
  serverUrl,
  serverName,
  serverId,
  headers,
  language,
}: SdkIntegrationModalProps) {
  const [copied, setCopied] = useState(false);

  const code =
    language === "typescript"
      ? generateTypeScriptSDKCode(serverUrl, serverName, serverId, headers)
      : generatePythonSDKCode(serverUrl, serverName, serverId, headers);

  const handleCopy = async () => {
    await copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const languageName = language === "typescript" ? "TypeScript" : "Python";
  const installCommand =
    language === "typescript" ? "npm install mcp-use" : "pip install mcp-use";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable className="max-w-[90vw] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add to {languageName} SDK</DialogTitle>
          <DialogDescription>
            Copy the following code to integrate this server into your{" "}
            {languageName} application using the mcp-use SDK.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <h5 className="font-semibold text-sm mb-2">Instructions</h5>
            <ol className="space-y-2 text-xs text-muted-foreground">
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">1.</span>
                <span>
                  Install the mcp-use package:{" "}
                  <code className="text-foreground">{installCommand}</code>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">2.</span>
                <span>
                  Copy the following code into your {languageName} project:
                </span>
              </li>
            </ol>
          </div>

          <div className="relative w-full overflow-x-auto">
            <div className="absolute top-2 right-2 z-10">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 bg-background hover:bg-accent border border-border"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="size-3.5 text-green-600" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
            <pre className="m-0 p-4 pr-12 rounded-lg text-xs font-mono overflow-auto w-full max-w-full bg-muted">
              <code>{code}</code>
            </pre>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
