import {
  Bell,
  CheckSquare,
  FolderOpen,
  LibraryBig,
  Hash,
  Info,
  MessageCircle,
  MessageSquare,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { TabType } from "@/client/context/InspectorContext";

export type LayoutTabDef =
  | { id: "separator" }
  | {
      id: TabType;
      label: string;
      icon: LucideIcon;
      alwaysExpanded?: boolean;
    };

export const LAYOUT_TABS: LayoutTabDef[] = [
  { id: "server-metadata", label: "Server Metadata", icon: Info },
  { id: "separator" },
  { id: "chat", label: "Chat", icon: MessageCircle, alwaysExpanded: true },
  { id: "separator" },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "prompts", label: "Prompts", icon: MessageSquare },
  { id: "resources", label: "Resources", icon: FolderOpen },
  { id: "skills", label: "Skills", icon: LibraryBig },
  { id: "sampling", label: "Sampling", icon: Hash },
  { id: "elicitation", label: "Elicitation", icon: CheckSquare },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "separator" },
  { id: "connection-settings", label: "Connection Settings", icon: Settings },
];
