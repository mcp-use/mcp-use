import React, { useState } from "react";
import {
  downloadMcpbFile,
  generateClaudeCodeCommand,
  generateCodexConfig,
  generateCursorDeepLink,
  generateGeminiCLICommand,
  generateVSCodeDeepLink,
  getEnvVarInstructions,
} from "../utils/mcpClientUtils.js";

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
  const [isOpen, setIsOpen] = useState(false);

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
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-lg mb-2">Add to Claude Code</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Execute the following command in your shell to add this server to
              Claude Code.
            </p>
          </div>

          <div>
            <h5 className="font-semibold text-sm mb-2">Instructions</h5>
            <ol className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
              <li className="flex gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  1.
                </span>
                <span>
                  Ensure the Claude Code executable is available in your path
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  2.
                </span>
                <span>Execute the following snippet in your shell:</span>
              </li>
            </ol>
          </div>

          <div className="relative">
            <button
              className="absolute top-2 right-2 z-10 px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600"
              onClick={() => handleCopy(command)}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <pre className="bg-gray-100 dark:bg-gray-900 p-3 pr-14 rounded-md text-xs overflow-x-auto border border-gray-300 dark:border-gray-700">
              <code className="language-bash">{command}</code>
            </pre>
          </div>

          {envInstructions && (
            <div>
              <h5 className="font-semibold text-sm mb-2">
                Environment Variables
              </h5>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                After installation, set these environment variables in your
                shell:
              </p>
              <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded-md text-xs overflow-x-auto border border-gray-300 dark:border-gray-700">
                <code className="language-bash">{envInstructions}</code>
              </pre>
            </div>
          )}

          <p className="text-xs text-gray-600 dark:text-gray-400">
            The MCP configuration supports environment variable expansion using{" "}
            <code className="text-gray-900 dark:text-gray-100">
              $&#123;VAR&#125;
            </code>{" "}
            syntax.
          </p>
        </div>
      );
    }

    if (selectedClient === "gemini-cli") {
      const { command, envVars } = generateGeminiCLICommand(url, name, headers);
      const envInstructions = getEnvVarInstructions(envVars);

      return (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-lg mb-2">Add to Gemini CLI</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Execute the following command in your shell to add this server to
              Gemini CLI.
            </p>
          </div>

          <div>
            <h5 className="font-semibold text-sm mb-2">Instructions</h5>
            <ol className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
              <li className="flex gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  1.
                </span>
                <span>
                  Ensure the Gemini CLI executable is available in your path
                </span>
              </li>
              {envInstructions && (
                <li className="flex gap-2">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    2.
                  </span>
                  <span>
                    Set these environment variables in your shell before running
                    the command:
                  </span>
                </li>
              )}
              <li className="flex gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">
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
              <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded-md text-xs overflow-x-auto border border-gray-300 dark:border-gray-700">
                <code className="language-bash">{envInstructions}</code>
              </pre>
            </div>
          )}

          <div className="relative">
            <button
              className="absolute top-2 right-2 z-10 px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600"
              onClick={() => handleCopy(command)}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <pre className="bg-gray-100 dark:bg-gray-900 p-3 pr-14 rounded-md text-xs overflow-x-auto border border-gray-300 dark:border-gray-700">
              <code className="language-bash">{command}</code>
            </pre>
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-400">
            Restart Gemini CLI to load the new configuration.
          </p>
        </div>
      );
    }

    if (selectedClient === "codex-cli") {
      const { config, envVars } = generateCodexConfig(url, name, headers);

      return (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-lg mb-2">Add to Codex CLI</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Add this configuration to your{" "}
              <code className="text-gray-900 dark:text-gray-100">
                ~/.codex/config.toml
              </code>{" "}
              file.
            </p>
          </div>

          <div>
            <h5 className="font-semibold text-sm mb-2">Instructions</h5>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Add this configuration to your{" "}
              <code className="text-gray-900 dark:text-gray-100">
                ~/.codex/config.toml
              </code>
              :
            </p>
          </div>

          <div className="relative">
            <button
              className="absolute top-2 right-2 z-10 px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600"
              onClick={() => handleCopy(config)}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <pre className="bg-gray-100 dark:bg-gray-900 p-3 pr-14 rounded-md text-xs overflow-x-auto border border-gray-300 dark:border-gray-700">
              <code className="language-toml">{config}</code>
            </pre>
          </div>

          {envVars.length > 0 && (
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                (optional) If you would rather use variables from your system's
                environment, replace the{" "}
                <code className="text-gray-900 dark:text-gray-100">
                  http_headers
                </code>{" "}
                key with the{" "}
                <code className="text-gray-900 dark:text-gray-100">
                  env_http_headers
                </code>{" "}
                key as shown in the commented section above.
              </p>
            </div>
          )}

          <p className="text-xs text-gray-600 dark:text-gray-400">
            Restart Codex CLI to load the new configuration.
          </p>
        </div>
      );
    }

    return null;
  };

  return (
    <>
      {/* Dropdown Menu */}
      <div className="relative inline-block">
        {trigger ? (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className="cursor-pointer"
          >
            {typeof trigger === "function"
              ? trigger({ isOpen, onClick: () => setIsOpen(!isOpen) })
              : React.isValidElement(trigger)
                ? React.cloneElement(
                    trigger as React.ReactElement<any>,
                    {
                      onClick: (e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsOpen(!isOpen);
                      },
                    } as any
                  )
                : trigger}
          </div>
        ) : (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${className}`}
          >
            <span>Add to Client</span>
            <svg
              className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        )}

        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown Content */}
            <div className="absolute right-0 mt-2 w-auto min-w-[300px] rounded-md shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 z-50">
              <div className="py-1">
                {/* Additional Items First */}
                {additionalItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={async () => {
                      setIsOpen(false);
                      await item.onClick();
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    {item.icon}
                    <span className="min-w-0 max-w-full whitespace-nowrap">
                      {item.label}
                    </span>
                  </button>
                ))}

                {additionalItems.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                )}

                {/* Client Options */}
                {showClients.cursor && (
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      handleCursorClick();
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <img
                      src="https://cdn.simpleicons.org/cursor"
                      alt="Cursor"
                      className="h-4 w-4"
                    />
                    <span className="min-w-0 max-w-full whitespace-nowrap">
                      Cursor
                    </span>
                  </button>
                )}

                {showClients.claudeCode && (
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      handleClaudeCodeClick();
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <img
                      src="https://cdn.simpleicons.org/claude"
                      alt="Claude"
                      className="h-4 w-4"
                    />
                    <span className="min-w-0 max-w-full whitespace-nowrap">
                      Claude Code
                    </span>
                  </button>
                )}

                {showClients.claudeDesktop && (
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      handleClaudeDesktopClick();
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <img
                      src="https://cdn.simpleicons.org/claude"
                      alt="Claude"
                      className="h-4 w-4"
                    />
                    <span className="min-w-0 max-w-full whitespace-nowrap">
                      Claude Desktop
                    </span>
                  </button>
                )}

                {showClients.vsCode && (
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      handleVSCodeClick();
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
                    </svg>
                    <span className="min-w-0 max-w-full whitespace-nowrap">
                      VS Code
                    </span>
                  </button>
                )}

                {showClients.geminiCli && (
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      handleGeminiCLIClick();
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <img
                      src="https://cdn.simpleicons.org/googlegemini"
                      alt="Gemini"
                      className="h-4 w-4"
                    />
                    <span className="min-w-0 max-w-full whitespace-nowrap">
                      Gemini CLI
                    </span>
                  </button>
                )}

                {showClients.codexCli && (
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      handleCodexCLIClick();
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <img
                      src="https://inspector-cdn.mcp-use.com/providers/openai.png"
                      alt="Codex"
                      className="h-4 w-4"
                    />
                    <span className="min-w-0 max-w-full whitespace-nowrap">
                      Codex CLI
                    </span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal for CLI instructions */}
      {showModal && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => {
              setShowModal(false);
              setSelectedClient(null);
            }}
          />

          {/* Modal */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => {
              setShowModal(false);
              setSelectedClient(null);
            }}
          >
            <div
              className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-y-auto border border-gray-200 dark:border-gray-700 p-6 relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedClient(null);
                }}
                className="absolute top-4 right-4 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close"
              >
                <svg
                  className="w-5 h-5 text-gray-500 dark:text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>

              {renderModalContent()}
            </div>
          </div>
        </>
      )}
    </>
  );
}
