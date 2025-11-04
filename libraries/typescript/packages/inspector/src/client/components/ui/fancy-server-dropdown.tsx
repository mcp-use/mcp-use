"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Circle } from "lucide-react";
import { useState } from "react";

import { cn } from "@/client/lib/utils";
import { RandomGradientBackground } from "./random-gradient-background";

interface ServerOption {
  id: string;
  name: string;
  color?: string;
}

interface FancyServerDropdownProps {
  servers: ServerOption[];
  selectedServer: string;
  onServerChange: (serverId: string) => void;
  className?: string;
}

export function FancyServerDropdown({
  servers,
  selectedServer,
  onServerChange,
  className,
}: FancyServerDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  const currentServer = servers.find((server) => server.id === selectedServer);

  return (
    <div className={cn("relative", className)}>
      <DropdownMenuPrimitive.Root open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            className="flex items-center relative space-x-3 z-50 px-2 py-2 rounded-full bg-white/20 backdrop-blur-md border border-gray-200/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all duration-200 hover:shadow-md"
            title={`Selected server: ${currentServer?.name || "None"}`}
          >
            <div className="w-8 h-8 rounded-full overflow-hidden">
              <RandomGradientBackground
                className="w-full h-full"
                color={currentServer?.color}
              >
                <div className="flex items-center justify-center w-full h-full">
                  <Circle className="size-6 text-white/90" />
                </div>
              </RandomGradientBackground>
            </div>
            <span className="text-sm font-medium text-gray-700">
              {currentServer?.name || "Select Server"}
            </span>
            {isOpen ? (
              <Check className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>
        </DropdownMenuPrimitive.Trigger>

        <DropdownMenuPrimitive.Content
          className={cn(
            "absolute top-0 left-0 z-40 min-w-[300px]",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "origin-top-left",
            "-translate-y-[60px] -translate-x-[10px]"
          )}
          sideOffset={0}
          align="start"
          style={{ width: "200px" }}
        >
          <div className="flex flex-col gap-3 rounded-[30px] p-3 bg-black/40 shadow-2xl shadow-black/25 backdrop-blur-md">
            {/* Other servers */}
            {servers
              .filter((server) => server.id !== selectedServer)
              .map((server) => (
                <DropdownMenuPrimitive.Item
                  key={server.id}
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-xl",
                    "hover:bg-white/10 transition-colors cursor-pointer",
                    "focus:bg-white/10 focus:outline-none"
                  )}
                  onClick={() => {
                    onServerChange(server.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="w-6 h-6 rounded-full overflow-hidden">
                    <RandomGradientBackground
                      className="w-full h-full"
                      color={server.color}
                    >
                      <div className="flex items-center justify-center w-full h-full">
                        <Circle className="w-3 h-3 text-white/90" />
                      </div>
                    </RandomGradientBackground>
                  </div>
                  <span className="text-sm text-white/80">{server.name}</span>
                </DropdownMenuPrimitive.Item>
              ))}
          </div>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Root>
    </div>
  );
}
