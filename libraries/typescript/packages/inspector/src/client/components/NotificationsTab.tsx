import type { MCPNotification } from "@/client/context/McpContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import {
  NotificationsTabHeader,
  NotificationsList,
  NotificationResultDisplay,
  type NotificationResult,
} from "./notifications";
import { formatRelativeTime } from "@/client/utils/time";

interface NotificationsTabProps {
  notifications: MCPNotification[];
  unreadCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  serverId: string;
  isConnected: boolean;
}

export function NotificationsTab({
  notifications,
  unreadCount: _unreadCount,
  markNotificationRead,
  markAllNotificationsRead: _markAllNotificationsRead,
  clearNotifications,
  serverId: _serverId,
  isConnected,
}: NotificationsTabProps) {
  const [selectedNotification, setSelectedNotification] =
    useState<MCPNotification | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const notificationDisplayRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userHasScrolledRef = useRef(false);

  // Auto-scroll to top when new notifications arrive (only if user hasn't scrolled)
  useEffect(() => {
    if (
      autoScroll &&
      notifications.length > 0 &&
      listRef.current &&
      !userHasScrolledRef.current
    ) {
      listRef.current.scrollTop = 0;
    }
  }, [notifications.length, autoScroll]);

  // Track user scroll to disable auto-scroll
  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;

    const handleScroll = () => {
      if (listElement.scrollTop > 0) {
        userHasScrolledRef.current = true;
        setAutoScroll(false);
      }
    };

    listElement.addEventListener("scroll", handleScroll);
    return () => listElement.removeEventListener("scroll", handleScroll);
  }, []);

  // Reset user scroll tracking when notifications are cleared
  useEffect(() => {
    if (notifications.length === 0) {
      userHasScrolledRef.current = false;
      setAutoScroll(true);
    }
  }, [notifications.length]);

  // Mark notification as read when selected
  useEffect(() => {
    if (selectedNotification && !selectedNotification.read) {
      markNotificationRead(selectedNotification.id);
    }
  }, [selectedNotification, markNotificationRead]);

  // Auto-focus search input when expanded
  useEffect(() => {
    if (isSearchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchExpanded]);

  const handleSearchBlur = useCallback(() => {
    if (!searchQuery.trim()) {
      setIsSearchExpanded(false);
    }
  }, [searchQuery]);

  // Filter notifications based on search query
  const filteredNotifications = useMemo(() => {
    if (!searchQuery.trim()) return notifications;

    const query = searchQuery.toLowerCase();
    return notifications.filter(
      (notification) =>
        notification.method.toLowerCase().includes(query) ||
        JSON.stringify(notification.params || {})
          .toLowerCase()
          .includes(query)
    );
  }, [notifications, searchQuery]);

  // Reset focused index when filtered notifications change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";

      if (isInputFocused || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const items = filteredNotifications;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev + 1;
          return next >= items.length ? 0 : next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? items.length - 1 : next;
        });
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        const notification = filteredNotifications[focusedIndex];
        if (notification) {
          handleNotificationSelect(notification);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusedIndex, filteredNotifications]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0) {
      const itemId = `notification-${filteredNotifications[focusedIndex]?.id}`;
      const element = document.getElementById(itemId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [focusedIndex, filteredNotifications]);

  const handleNotificationSelect = useCallback(
    (notification: MCPNotification) => {
      setSelectedNotification(notification);
    },
    []
  );

  const handleClearAll = useCallback(() => {
    if (
      window.confirm(
        "Are you sure you want to clear all notifications? This cannot be undone."
      )
    ) {
      clearNotifications();
      setSelectedNotification(null);
    }
  }, [clearNotifications]);

  const handleCopy = useCallback(async () => {
    if (!selectedNotification) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            method: selectedNotification.method,
            timestamp: selectedNotification.timestamp,
            read: selectedNotification.read,
            params: selectedNotification.params,
          },
          null,
          2
        )
      );
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("[NotificationsTab] Failed to copy notification:", error);
    }
  }, [selectedNotification]);

  const handleDownload = useCallback(() => {
    if (!selectedNotification) return;
    try {
      const blob = new globalThis.Blob(
        [
          JSON.stringify(
            {
              method: selectedNotification.method,
              timestamp: selectedNotification.timestamp,
              read: selectedNotification.read,
              params: selectedNotification.params,
            },
            null,
            2
          ),
        ],
        {
          type: "application/json",
        }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `notification-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(
        "[NotificationsTab] Failed to download notification:",
        error
      );
    }
  }, [selectedNotification]);

  const handleFullscreen = useCallback(async () => {
    if (!notificationDisplayRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await notificationDisplayRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("[NotificationsTab] Failed to toggle fullscreen:", error);
    }
  }, []);

  // Convert selected notification to NotificationResult format
  const notificationResult: NotificationResult | null = selectedNotification
    ? {
        method: selectedNotification.method,
        params: selectedNotification.params,
        timestamp: selectedNotification.timestamp,
        read: selectedNotification.read,
        formatRelativeTime,
      }
    : null;

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Bell className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">
          Not connected to server
        </p>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={40} minSize={30}>
        <ResizablePanelGroup
          direction="vertical"
          className="h-full border-r dark:border-zinc-700"
        >
          <ResizablePanel defaultSize={75} minSize={30}>
            <NotificationsTabHeader
              isSearchExpanded={isSearchExpanded}
              searchQuery={searchQuery}
              filteredNotificationsCount={filteredNotifications.length}
              notificationsCount={notifications.length}
              onSearchExpand={() => setIsSearchExpanded(true)}
              onSearchChange={setSearchQuery}
              onSearchBlur={handleSearchBlur}
              onClearAll={handleClearAll}
              searchInputRef={
                searchInputRef as React.RefObject<HTMLInputElement>
              }
            />

            <div className="flex flex-col h-full">
              <NotificationsList
                notifications={filteredNotifications}
                selectedNotification={selectedNotification}
                onNotificationSelect={handleNotificationSelect}
                focusedIndex={focusedIndex}
                formatRelativeTime={formatRelativeTime}
                listRef={listRef}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={60} minSize={40}>
        <div
          ref={notificationDisplayRef}
          className="h-full bg-white dark:bg-zinc-900"
        >
          <NotificationResultDisplay
            notification={notificationResult}
            previewMode={previewMode}
            onTogglePreview={() => setPreviewMode(!previewMode)}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onFullscreen={handleFullscreen}
            onClose={() => setSelectedNotification(null)}
            isCopied={isCopied}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
