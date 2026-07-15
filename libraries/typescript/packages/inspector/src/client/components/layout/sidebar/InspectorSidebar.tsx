import { cn } from "@/client/lib/utils";
import type { TabType } from "@/client/context/InspectorContext";
import type { McpServer } from "@mcp-use/client/react";
import { SidebarRail } from "../SidebarRail";
import { InspectorSidebarFooter } from "./InspectorSidebarFooter";
import { InspectorSidebarNav } from "./InspectorSidebarNav";
import { SidebarProximityNav } from "./SidebarProximityNav";

interface InspectorSidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  selectedServer: McpServer;
  visibleTabs?: TabType[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  rpcLoggerOpen: boolean;
  onRpcLoggerOpenChange: (open: boolean) => void;
  onCommandPaletteOpen: () => void;
}

export function InspectorSidebar({
  activeTab,
  onTabChange,
  selectedServer,
  visibleTabs,
  collapsed,
  onCollapsedChange,
  rpcLoggerOpen,
  onRpcLoggerOpenChange,
  onCommandPaletteOpen,
}: InspectorSidebarProps) {
  return (
    <aside
      className={cn(
        "group/sidebar relative hidden lg:flex flex-col shrink-0 text-sidebar-foreground transition-[width] duration-200 ease-out @container/sidebar",
        collapsed ? "w-(--sidebar-width-icon)" : "w-(--sidebar-width)"
      )}
      data-collapsed={collapsed}
      data-collapsible={collapsed ? "icon" : "expanded"}
    >
      <div className="sidebar-nav-scroll flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <SidebarProximityNav
          isActiveKey={(key) => key === activeTab}
          className="pb-2"
        >
          <InspectorSidebarNav
            activeTab={activeTab}
            onTabChange={onTabChange}
            selectedServer={selectedServer}
            visibleTabs={visibleTabs}
            collapsed={collapsed}
          />
        </SidebarProximityNav>
      </div>
      <InspectorSidebarFooter
        collapsed={collapsed}
        rpcLoggerOpen={rpcLoggerOpen}
        onRpcLoggerOpenChange={onRpcLoggerOpenChange}
        onCommandPaletteOpen={onCommandPaletteOpen}
      />
      <SidebarRail
        collapsed={collapsed}
        onToggle={() => onCollapsedChange(!collapsed)}
      />
    </aside>
  );
}
