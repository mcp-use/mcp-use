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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Check, ChevronDown, Copy, Plus } from "lucide-react";
import {
  downloadMcpbFile,
  generateClaudeCodeCommand,
  generateCodexConfig,
  generateCursorDeepLink,
  generateGeminiCLICommand,
  generateVSCodeDeepLink,
  getEnvVarInstructions,
} from "@/client/utils/mcpClientUtils";
import { useState } from "react";
import { VSCodeIcon } from "./ui/client-icons";

interface AddToClientDropdownProps {
  serverConfig: {
    url: string;
    name: string;
    headers?: Record<string, string>;
    serverId?: string;
  };
  additionalItems?: Array<{
    id: string;
    label: string;
    icon?: React.ReactNode;
    onClick: () => void | Promise<void>;
  }>;
  showClients?: {
    cursor?: boolean;
    vsCode?: boolean;
    claudeDesktop?: boolean;
    claudeCode?: boolean;
    geminiCli?: boolean;
    codexCli?: boolean;
  };
  className?: string;
  onSuccess?: (client: string) => void;
  onError?: (error: Error) => void;
  trigger?:
    | React.ReactNode
    | ((props: { isOpen: boolean; onClick: () => void }) => React.ReactNode);
}

type ClientType = "claude-code" | "gemini-cli" | "codex-cli" | null;

/**
 * Reusable dropdown component for adding MCP servers to various clients
 *
 * @example
 * ```tsx
 * <AddToClientDropdown
 *   serverConfig={{
 *     url: "https://mcp.example.com/mcp",
 *     name: "My Server",
 *     headers: { Authorization: "Bearer token" }
 *   }}
 *   additionalItems={[{
 *     id: "agent",
 *     label: "Add to mcp-use Agent",
 *     onClick: () => handleAddToAgent()
 *   }]}
 * />
 * ```
 */
export function AddToClientDropdown({
  serverConfig,
  additionalItems = [],
  showClients = {
    cursor: true,
    vsCode: true,
    claudeDesktop: true,
    claudeCode: true,
    geminiCli: true,
    codexCli: true,
  },
  className = "",
  onSuccess,
  onError,
  trigger,
}: AddToClientDropdownProps) {
  const [showModal, setShowModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientType>(null);
  const [copied, setCopied] = useState(false);

  const { url, name, headers } = serverConfig;

  const handleCursorClick = () => {
    try {
      const deepLink = generateCursorDeepLink(url, name, headers);
      window.location.href = deepLink;
      onSuccess?.("Cursor");
    } catch (error) {
      console.error("Failed to generate Cursor deep link:", error);
      onError?.(error as Error);
    }
  };

  const handleVSCodeClick = () => {
    try {
      const deepLink = generateVSCodeDeepLink(url, name, headers);
      window.location.href = deepLink;
      onSuccess?.("VS Code");
    } catch (error) {
      console.error("Failed to generate VS Code deep link:", error);
      onError?.(error as Error);
    }
  };

  const handleClaudeDesktopClick = () => {
    try {
      downloadMcpbFile(url, name, headers);
      onSuccess?.("Claude Desktop");
    } catch (error) {
      console.error("Failed to download .mcpb file:", error);
      onError?.(error as Error);
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
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      onError?.(error as Error);
    }
  };

  const renderModalContent = () => {
    if (selectedClient === "claude-code") {
      const { command, envVars } = generateClaudeCodeCommand(
        url,
        name,
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
      const { command, envVars } = generateGeminiCLICommand(url, name, headers);
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
      const { config, envVars } = generateCodexConfig(url, name, headers);

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

  const defaultTrigger = (
    <Button
      variant="ghost"
      className={`bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-full transition-colors px-3 flex items-center justify-center ${className}`}
    >
      <span className="xl:hidden hidden sm:flex items-center gap-1">
        <Plus className="size-3" />
        Client
      </span>
      <span className="hidden xl:flex items-center gap-1">
        Add to Client
        <ChevronDown className="size-3" />
      </span>
    </Button>
  );

  const triggerElement = trigger
    ? typeof trigger === "function"
      ? trigger({
          isOpen: false,
          onClick: () => {},
        })
      : trigger
    : defaultTrigger;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{triggerElement}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-[300px]">
          {/* Additional Items First */}
          {additionalItems.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onClick={async () => {
                await item.onClick();
              }}
              className="flex items-center gap-2"
            >
              {item.icon}
              <span className="min-w-0 max-w-full whitespace-nowrap">
                {item.label}
              </span>
            </DropdownMenuItem>
          ))}

          {additionalItems.length > 0 && <DropdownMenuSeparator />}

          {/* Client Options */}
          {showClients.cursor && (
            <DropdownMenuItem
              onClick={handleCursorClick}
              className="flex items-center gap-2"
            >
              <img
                src="https://cdn.simpleicons.org/cursor"
                alt="Cursor"
                className="h-4 w-4"
              />
              <span className="min-w-0 max-w-full whitespace-nowrap">
                Cursor
              </span>
            </DropdownMenuItem>
          )}

          {showClients.claudeCode && (
            <DropdownMenuItem
              onClick={handleClaudeCodeClick}
              className="flex items-center gap-2"
            >
              <img
                src="https://cdn.simpleicons.org/claude"
                alt="Claude"
                className="h-4 w-4"
              />
              <span className="min-w-0 max-w-full whitespace-nowrap">
                Claude Code
              </span>
            </DropdownMenuItem>
          )}

          {showClients.claudeDesktop && (
            <DropdownMenuItem
              onClick={handleClaudeDesktopClick}
              className="flex items-center gap-2"
            >
              <img
                src="https://cdn.simpleicons.org/claude"
                alt="Claude"
                className="h-4 w-4"
              />
              <span className="min-w-0 max-w-full whitespace-nowrap">
                Claude Desktop
              </span>
            </DropdownMenuItem>
          )}

          {showClients.vsCode && (
            <DropdownMenuItem
              onClick={handleVSCodeClick}
              className="flex items-center gap-2"
            >
              <VSCodeIcon className="h-4 w-4" />
              <span className="min-w-0 max-w-full whitespace-nowrap">
                VS Code
              </span>
            </DropdownMenuItem>
          )}

          {showClients.geminiCli && (
            <DropdownMenuItem
              onClick={handleGeminiCLIClick}
              className="flex items-center gap-2"
            >
              <img
                src="https://cdn.simpleicons.org/googlegemini"
                alt="Gemini"
                className="h-4 w-4"
              />
              <span className="min-w-0 max-w-full whitespace-nowrap">
                Gemini CLI
              </span>
            </DropdownMenuItem>
          )}

          {showClients.codexCli && (
            <DropdownMenuItem
              onClick={handleCodexCLIClick}
              className="flex items-center gap-2"
            >
              <img
                src="https://inspector-cdn.mcp-use.com/providers/openai.png"
                alt="Codex"
                className="h-4 w-4"
              />
              <span className="min-w-0 max-w-full whitespace-nowrap">
                Codex CLI
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Modal for CLI instructions */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {renderModalContent()}
        </DialogContent>
      </Dialog>
    </>
  );
}
