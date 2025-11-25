import type { MCPNotification } from "@/client/context/McpContext";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Bell, Check, Search, Trash2, X } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { Input } from "@/client/components/ui/input";
import { Badge } from "@/client/components/ui/badge";
import { ListItem } from "./shared/ListItem";
import { cn } from "@/client/lib/utils";

interface NotificationsTabProps {
  notifications: MCPNotification[];
  unreadCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  serverId: string;
  isConnected: boolean;
}

function getNotificationColor(method: string): string {
  if (method.startsWith("notifications/tools/")) {
    return "bg-blue-500";
  } else if (method.startsWith("notifications/resources/")) {
    return "bg-green-500";
  } else if (method.startsWith("notifications/prompts/")) {
    return "bg-purple-500";
  } else {
    return "bg-orange-500";
  }
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "just now";
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}

export function NotificationsTab({
  notifications,
  unreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotifications,
  serverId,
  isConnected,
}: NotificationsTabProps) {
  const [selectedNotification, setSelectedNotification] =
    useState<MCPNotification | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new notifications arrive
  useEffect(() => {
    if (autoScroll && notifications.length > 0 && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [notifications.length, autoScroll]);

  // Mark notification as read when selected
  useEffect(() => {
    if (selectedNotification && !selectedNotification.read) {
      markNotificationRead(selectedNotification.id);
    }
  }, [selectedNotification, markNotificationRead]);

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

  // Group notifications by method type
  const groupedNotifications = useMemo(() => {
    const groups: Record<string, MCPNotification[]> = {};
    filteredNotifications.forEach((notification) => {
      const groupKey = notification.method.split("/")[0] || "other";
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(notification);
    });
    return groups;
  }, [filteredNotifications]);

  const handleNotificationSelect = useCallback(
    (notification: MCPNotification) => {
      setSelectedNotification(notification);
    },
    []
  );

  const handleMarkAllRead = useCallback(() => {
    markAllNotificationsRead();
  }, [markAllNotificationsRead]);

  const handleClearAll = useCallback(() => {
    if (
      confirm(
        "Are you sure you want to clear all notifications? This cannot be undone."
      )
    ) {
      clearNotifications();
      setSelectedNotification(null);
    }
  }, [clearNotifications]);

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b dark:border-zinc-700">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search notifications..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            <Check className="h-4 w-4 mr-2" />
            Mark all read
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            disabled={notifications.length === 0}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear all
          </Button>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Main Content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Panel: Notifications List */}
        <ResizablePanel defaultSize={40} minSize={30}>
          <div className="flex flex-col h-full">
            {filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <Bell className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
                <p className="text-gray-500 dark:text-gray-400">
                  {notifications.length === 0
                    ? "No notifications yet"
                    : "No notifications match your search"}
                </p>
              </div>
            ) : (
              <div
                ref={listRef}
                className="overflow-y-auto flex-1 overscroll-contain"
              >
                {Object.entries(groupedNotifications).map(
                  ([groupKey, groupNotifications]) => (
                    <div key={groupKey} className="mb-4">
                      <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-zinc-800/50 sticky top-0">
                        {groupKey}
                      </div>
                      {groupNotifications.map((notification, index) => {
                        const globalIndex = filteredNotifications.findIndex(
                          (n) => n.id === notification.id
                        );
                        const color = getNotificationColor(notification.method);
                        return (
                          <ListItem
                            key={notification.id}
                            id={`notification-${notification.id}`}
                            isSelected={
                              selectedNotification?.id === notification.id
                            }
                            isFocused={focusedIndex === globalIndex}
                            icon={
                              <div
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  !notification.read && color
                                )}
                              />
                            }
                            title={notification.method}
                            description={
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {!notification.read && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs border-red-500 text-red-600 dark:text-red-400"
                                    >
                                      Unread
                                    </Badge>
                                  )}
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-xs",
                                      notification.method.startsWith(
                                        "notifications/tools/"
                                      ) && "border-blue-500 text-blue-600 dark:text-blue-400",
                                      notification.method.startsWith(
                                        "notifications/resources/"
                                      ) && "border-green-500 text-green-600 dark:text-green-400",
                                      notification.method.startsWith(
                                        "notifications/prompts/"
                                      ) && "border-purple-500 text-purple-600 dark:text-purple-400",
                                      !notification.method.startsWith(
                                        "notifications/"
                                      ) &&
                                        "border-orange-500 text-orange-600 dark:text-orange-400"
                                    )}
                                  >
                                    {notification.method.split("/").pop() ||
                                      notification.method}
                                  </Badge>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {formatRelativeTime(notification.timestamp)}
                                  </span>
                                </div>
                                {notification.params &&
                                  Object.keys(notification.params).length >
                                    0 && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">
                                      {Object.keys(notification.params).length}{" "}
                                      param
                                      {Object.keys(notification.params).length >
                                      1
                                        ? "s"
                                        : ""}
                                    </span>
                                  )}
                              </div>
                            }
                            onClick={() => handleNotificationSelect(notification)}
                          />
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Right Panel: Notification Details */}
        <ResizablePanel defaultSize={60} minSize={40}>
          <div className="flex flex-col h-full">
            {selectedNotification ? (
              <div className="flex flex-col h-full">
                <div className="p-4 border-b dark:border-zinc-700 flex items-center justify-between">
                  <h2 className="text-lg font-semibold font-mono">
                    {selectedNotification.method}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedNotification(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Method</h3>
                    <code className="block p-2 bg-gray-100 dark:bg-zinc-800 rounded text-sm font-mono">
                      {selectedNotification.method}
                    </code>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Timestamp</h3>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {new Date(selectedNotification.timestamp).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      {formatRelativeTime(selectedNotification.timestamp)}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Status</h3>
                    <Badge
                      variant={selectedNotification.read ? "outline" : "default"}
                      className={
                        selectedNotification.read
                          ? ""
                          : "bg-red-500 text-white"
                      }
                    >
                      {selectedNotification.read ? "Read" : "Unread"}
                    </Badge>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Parameters</h3>
                    {selectedNotification.params ? (
                      <pre className="p-4 bg-gray-100 dark:bg-zinc-800 rounded text-sm font-mono overflow-x-auto">
                        {JSON.stringify(selectedNotification.params, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                        No parameters
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <Bell className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
                <p className="text-gray-500 dark:text-gray-400">
                  Select a notification to view details
                </p>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

