import type { TabType } from "@/client/context/InspectorContext";
import type { MCPConnection } from "@/client/context/McpContext";
import {
  Check,
  Command,
  Copy,
  FolderOpen,
  MessageCircle,
  MessageSquare,
  Wrench,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { GithubIcon } from "@/client/components/ui/github-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useInspector } from "@/client/context/InspectorContext";
import { cn } from "@/client/lib/utils";
import { AnimatedThemeToggler } from "./AnimatedThemeToggler";
import LogoAnimated from "./LogoAnimated";
import { ServerDropdown } from "./ServerDropdown";

interface LayoutHeaderProps {
  connections: MCPConnection[];
  selectedServer: MCPConnection | undefined;
  activeTab: string;
  onServerSelect: (serverId: string) => void;
  onTabChange: (tab: TabType) => void;
  onCommandPaletteOpen: () => void;
  onOpenConnectionOptions: (connectionId: string | null) => void;
}

const tabs = [
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "prompts", label: "Prompts", icon: MessageSquare },
  { id: "resources", label: "Resources", icon: FolderOpen },
  { id: "chat", label: "Chat", icon: MessageCircle },
];

export function LayoutHeader({
  connections,
  selectedServer,
  activeTab,
  onServerSelect,
  onTabChange,
  onCommandPaletteOpen,
  onOpenConnectionOptions,
}: LayoutHeaderProps) {
  const { tunnelUrl } = useInspector();
  const showTunnelBadge = selectedServer && tunnelUrl;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!tunnelUrl) return;

    try {
      await navigator.clipboard.writeText(`${tunnelUrl}/mcp`);
      setCopied(true);
      toast.success("Tunnel URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  return (
    <header className="w-full mx-auto">
      <div className="flex items-center justify-between">
        {/* Left side: Server dropdown + Tabs + Tunnel Badge */}
        <div className="flex items-center space-x-6">
          {/* Server Selection Dropdown */}
          <ServerDropdown
            connections={connections}
            selectedServer={selectedServer}
            onServerSelect={onServerSelect}
            onOpenConnectionOptions={onOpenConnectionOptions}
          />

          {/* Tabs */}
          {selectedServer && (
            <Tabs
              value={activeTab}
              onValueChange={(tab) => onTabChange(tab as TabType)}
            >
              <TabsList>
                {tabs.map((tab) => {
                  // Get count for the current tab
                  let count = 0;
                  if (tab.id === "tools") {
                    count = selectedServer.tools.length;
                  } else if (tab.id === "prompts") {
                    count = selectedServer.prompts.length;
                  } else if (tab.id === "resources") {
                    count = selectedServer.resources.length;
                  }

                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      icon={tab.icon}
                      className="[&>svg]:mr-0 lg:[&>svg]:mr-2"
                    >
                      <div className="items-center gap-2 hidden lg:flex">
                        {tab.label}
                        {count > 0 && (
                          <span
                            className={cn(
                              activeTab === tab.id
                                ? " dark:bg-black "
                                : "dark:bg-zinc-700",
                              "bg-zinc-200 text-zinc-700 dark:text-zinc-300 text-xs px-2 py-0.5 rounded-full font-medium"
                            )}
                          >
                            {count}
                          </span>
                        )}
                      </div>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          )}

          {/* Tunnel Badge */}
          {showTunnelBadge && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500/10 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/20 border border-purple-500/30 dark:border-purple-500/40 rounded-full hover:from-purple-500/20 hover:to-pink-500/20 dark:hover:from-purple-500/30 dark:hover:to-pink-500/30 transition-colors cursor-pointer">
                  <Zap className="size-4 text-purple-600 dark:text-purple-400 animate-pulse" />
                  <span className="text-xs font-medium text-purple-700 dark:text-purple-300 hidden lg:inline">
                    Tunnel
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-96" align="start">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                      <Zap className="size-4 text-purple-600 dark:text-purple-400" />
                      Tunnel URL
                    </h4>
                    <div className="flex items-center gap-2 p-2 py-0 bg-muted rounded-full">
                      <code className="flex-1 text-[10px] font-mono">
                        {tunnelUrl}
                        /mcp
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleCopy}
                      >
                        {copied ? (
                          <Check className="size-3.5 text-green-600" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <h5 className="font-semibold text-sm mb-2">
                      Use in ChatGPT
                    </h5>
                    <ol className="space-y-2 text-xs text-muted-foreground">
                      <li className="flex gap-2">
                        <span className="font-semibold text-foreground">
                          1.
                        </span>
                        <span>
                          Enable{" "}
                          <span className="font-medium text-foreground">
                            dev mode
                          </span>{" "}
                          from settings
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold text-foreground">
                          2.
                        </span>
                        <span>
                          In{" "}
                          <span className="font-medium text-foreground">
                            App & Connectors
                          </span>{" "}
                          click on{" "}
                          <span className="font-medium text-foreground">
                            create
                          </span>
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold text-foreground">
                          3.
                        </span>
                        <span>Use the tunnel URL in the input</span>
                      </li>
                    </ol>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Right side: Theme Toggle + Command Palette + Discord Button + Logo */}
        <div className="flex items-center gap-4">
          <Tooltip>
            <TooltipTrigger>
              <AnimatedThemeToggler className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors cursor-pointer" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle theme</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full px-1 -mx-3 flex gap-1"
                onClick={onCommandPaletteOpen}
              >
                <Command className="size-4" />
                <span className="text-base font-mono">K</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Command Palette</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" asChild>
                <a
                  href="https://github.com/mcp-use/mcp-use"
                  className="flex items-center gap-2"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GithubIcon className="h-4 w-4" />
                  Github
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Give us a star ⭐</p>
            </TooltipContent>
          </Tooltip>

          <LogoAnimated state="expanded" />
        </div>
      </div>
    </header>
  );
}
