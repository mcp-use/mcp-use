import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  downloadMcpbFile,
  generateClaudeCodeCommand,
  generateCodexConfig,
  generateCursorDeepLink,
  generateGeminiCLICommand,
  generateVSCodeDeepLink,
  getEnvVarInstructions,
} from "@/client/utils/mcpClientUtils";
import { Check, ChevronDown, Copy } from "lucide-react";
import { VSCodeIcon } from "./ui/client-icons";
import { useState } from "react";
import { toast } from "sonner";

interface AddToClientDropdownProps {
  serverUrl: string;
  serverName: string;
  headers?: Record<string, string>;
  className?: string;
}

type ClientType = "claude-code" | "gemini-cli" | "codex-cli" | null;

export function AddToClientDropdown({
  serverUrl,
  serverName,
  headers,
  className,
}: AddToClientDropdownProps) {
  const [showModal, setShowModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientType>(null);
  const [copied, setCopied] = useState(false);

  const handleCursorClick = () => {
    try {
      const deepLink = generateCursorDeepLink(serverUrl, serverName, headers);
      window.location.href = deepLink;
      toast.success("Opening in Cursor...");
    } catch (error) {
      console.error("Failed to generate Cursor deep link:", error);
      toast.error("Failed to open in Cursor");
    }
  };

  const handleVSCodeClick = () => {
    try {
      const deepLink = generateVSCodeDeepLink(serverUrl, serverName, headers);
      window.location.href = deepLink;
      toast.success("Opening in VS Code...");
    } catch (error) {
      console.error("Failed to generate VS Code deep link:", error);
      toast.error("Failed to open in VS Code");
    }
  };

  const handleClaudeDesktopClick = () => {
    try {
      downloadMcpbFile(serverUrl, serverName, headers);
      toast.success("Downloaded .mcpb file");
    } catch (error) {
      console.error("Failed to download .mcpb file:", error);
      toast.error("Failed to download configuration file");
    }
  };

  const handleClaudeCodeClick = () => {
    setSelectedClient("claude-code");
    setShowModal(true);
  };

  const handleGeminiCLIClick = () => {
    setSelectedClient("gemini-cli");
    setShowModal(true);
  };

  const handleCodexCLIClick = () => {
    setSelectedClient("codex-cli");
    setShowModal(true);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      toast.error("Failed to copy to clipboard");
    }
  };

  const renderModalContent = () => {
    if (selectedClient === "claude-code") {
      const { command, envVars } = generateClaudeCodeCommand(
        serverUrl,
        serverName,
        headers
      );
      const envInstructions = getEnvVarInstructions(envVars);

      return (
        <>
          <DialogHeader>
            <DialogTitle>Add to Claude Code</DialogTitle>
            <DialogDescription>
              Execute the following command in your shell to add this server to
              Claude Code.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h5 className="font-semibold text-sm mb-2">Instructions</h5>
              <ol className="space-y-2 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">1.</span>
                  <span>
                    Ensure the Claude Code executable is available in your path
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">2.</span>
                  <span>Execute the following snippet in your shell:</span>
                </li>
              </ol>
            </div>

            <div className="relative">
              <div className="absolute top-2 right-2 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 bg-background hover:bg-accent border border-border"
                  onClick={() => handleCopy(command)}
                >
                  {copied ? (
                    <Check className="size-3.5 text-green-600" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
              <pre className="bg-muted p-3 pr-14 rounded-md text-xs overflow-x-auto">
                <code>{command}</code>
              </pre>
            </div>

            {envInstructions && (
              <div>
                <h5 className="font-semibold text-sm mb-2">
                  Environment Variables
                </h5>
                <p className="text-xs text-muted-foreground mb-2">
                  After installation, set these environment variables in your
                  shell:
                </p>
                <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                  <code>{envInstructions}</code>
                </pre>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              The MCP configuration supports environment variable expansion
              using <code className="text-foreground">$&#123;VAR&#125;</code>{" "}
              syntax.
            </p>
          </div>
        </>
      );
    }

    if (selectedClient === "gemini-cli") {
      const { command, envVars } = generateGeminiCLICommand(
        serverUrl,
        serverName,
        headers
      );
      const envInstructions = getEnvVarInstructions(envVars);

      return (
        <>
          <DialogHeader>
            <DialogTitle>Add to Gemini CLI</DialogTitle>
            <DialogDescription>
              Execute the following command in your shell to add this server to
              Gemini CLI.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h5 className="font-semibold text-sm mb-2">Instructions</h5>
              <ol className="space-y-2 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">1.</span>
                  <span>
                    Ensure the Gemini CLI executable is available in your path
                  </span>
                </li>
                {envInstructions && (
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">2.</span>
                    <span>
                      Set these environment variables in your shell before
                      running the command:
                    </span>
                  </li>
                )}
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">
                    {envInstructions ? "3." : "2."}
                  </span>
                  <span>Execute the following snippet in your shell:</span>
                </li>
              </ol>
            </div>

            {envInstructions && (
              <div>
                <h5 className="font-semibold text-sm mb-2">
                  Environment Variables
                </h5>
                <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                  <code>{envInstructions}</code>
                </pre>
              </div>
            )}

            <div className="relative">
              <div className="absolute top-2 right-2 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 bg-background hover:bg-accent border border-border"
                  onClick={() => handleCopy(command)}
                >
                  {copied ? (
                    <Check className="size-3.5 text-green-600" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
              <pre className="bg-muted p-3 pr-14 rounded-md text-xs overflow-x-auto">
                <code>{command}</code>
              </pre>
            </div>

            <p className="text-xs text-muted-foreground">
              Restart Gemini CLI to load the new configuration.
            </p>
          </div>
        </>
      );
    }

    if (selectedClient === "codex-cli") {
      const { config, envVars } = generateCodexConfig(
        serverUrl,
        serverName,
        headers
      );

      return (
        <>
          <DialogHeader>
            <DialogTitle>Add to Codex CLI</DialogTitle>
            <DialogDescription>
              Add this configuration to your{" "}
              <code className="text-foreground">~/.codex/config.toml</code>{" "}
              file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h5 className="font-semibold text-sm mb-2">Instructions</h5>
              <p className="text-xs text-muted-foreground">
                Add this configuration to your{" "}
                <code className="text-foreground">~/.codex/config.toml</code>:
              </p>
            </div>

            <div className="relative">
              <div className="absolute top-2 right-2 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 bg-background hover:bg-accent border border-border"
                  onClick={() => handleCopy(config)}
                >
                  {copied ? (
                    <Check className="size-3.5 text-green-600" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
              <pre className="bg-muted p-3 pr-14 rounded-md text-xs overflow-x-auto">
                <code>{config}</code>
              </pre>
            </div>

            {envVars.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">
                  (optional) If you would rather use variables from your
                  system's environment, replace the{" "}
                  <code className="text-foreground">http_headers</code> key with
                  the <code className="text-foreground">env_http_headers</code>{" "}
                  key as shown in the commented section above.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Restart Codex CLI to load the new configuration.
            </p>
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={`bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors px-3 ${className || ""}`}
                aria-label="Add to Client"
              >
                <span className="hidden sm:inline ml-2">Add to Client</span>
                <ChevronDown className="size-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Add to Client</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={handleCursorClick}
            className="flex items-center gap-2"
          >
            <img
              src="https://cdn.simpleicons.org/cursor"
              alt="Cursor"
              className="h-4 w-4"
            />
            <span>Cursor</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleClaudeCodeClick}
            className="flex items-center gap-2"
          >
            <img
              src="https://cdn.simpleicons.org/claude"
              alt="Claude"
              className="h-4 w-4"
            />
            <span>Claude Code</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleClaudeDesktopClick}
            className="flex items-center gap-2"
          >
            <img
              src="https://cdn.simpleicons.org/claude"
              alt="Claude"
              className="h-4 w-4"
            />
            <span>Claude Desktop</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleVSCodeClick}
            className="flex items-center gap-2"
          >
            <VSCodeIcon className="h-4 w-4" />
            <span>VS Code</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleGeminiCLIClick}
            className="flex items-center gap-2"
          >
            <img
              src="https://cdn.simpleicons.org/googlegemini"
              alt="Gemini"
              className="h-4 w-4"
            />
            <span>Gemini CLI</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleCodexCLIClick}
            className="flex items-center gap-2"
          >
            <img
              src="https://inspector-cdn.mcp-use.com/providers/openai.png"
              alt="Codex"
              className="h-4 w-4"
            />
            <span>Codex CLI</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {renderModalContent()}
        </DialogContent>
      </Dialog>
    </>
  );
}
