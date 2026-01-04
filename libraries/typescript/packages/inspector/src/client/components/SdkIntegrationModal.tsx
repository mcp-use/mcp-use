import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { usePrismTheme } from "@/client/hooks/usePrismTheme";
import {
  generatePythonSDKCode,
  generateTypeScriptSDKCode,
} from "mcp-use/react";
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

export function SdkIntegrationModal({
  open,
  onOpenChange,
  serverUrl,
  serverName,
  serverId,
  headers,
  language,
}: SdkIntegrationModalProps) {
  const { prismStyle } = usePrismTheme();
  const [copied, setCopied] = useState(false);

  const code =
    language === "typescript"
      ? generateTypeScriptSDKCode(serverUrl, serverName, serverId, headers)
      : generatePythonSDKCode(serverUrl, serverName, serverId, headers);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const languageName = language === "typescript" ? "TypeScript" : "Python";
  const installCommand =
    language === "typescript" ? "npm install mcp-use" : "pip install mcp-use";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Add to {languageName} SDK</DialogTitle>
          <DialogDescription>
            Copy the following code to integrate this server into your{" "}
            {languageName} application using the mcp-use SDK.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
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

          <div className="relative w-full overflow-x-auto overflow-y-auto max-h-[60vh]">
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
            <SyntaxHighlighter
              language={language}
              style={prismStyle}
              customStyle={{
                margin: 0,
                padding: "1rem",
                paddingRight: "3rem",
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
                background: "var(--muted)",
                width: "100%",
                maxWidth: "100%",
                overflow: "auto",
              }}
              wrapLines={true}
              wrapLongLines={true}
              PreTag="div"
            >
              {code}
            </SyntaxHighlighter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
