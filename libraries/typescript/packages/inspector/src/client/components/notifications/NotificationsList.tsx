import type { MCPNotification } from "@/client/context/McpContext";
import { Bell } from "lucide-react";
import { ListItem } from "@/client/components/shared/ListItem";

interface NotificationsListProps {
  notifications: MCPNotification[];
  selectedNotification: MCPNotification | null;
  onNotificationSelect: (notification: MCPNotification) => void;
  focusedIndex: number;
  formatRelativeTime: (timestamp: number) => string;
  listRef?:
    | React.RefObject<HTMLDivElement>
    | React.MutableRefObject<HTMLDivElement | null>;
}

export function NotificationsList({
  notifications,
  selectedNotification,
  onNotificationSelect,
  focusedIndex,
  formatRelativeTime,
  listRef,
}: NotificationsListProps) {
  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Bell className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">No notifications yet</p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="overflow-y-auto flex-1 overscroll-contain">
      {notifications.map((notification, index) => {
        return (
          <ListItem
            key={notification.id}
            id={`notification-${notification.id}`}
            isSelected={selectedNotification?.id === notification.id}
            isFocused={focusedIndex === index}
            title={
              <span className="flex items-center gap-3">
                {notification.method}
                {!notification.read && (
                  <span className="size-1.5 block rounded-full bg-orange-500" />
                )}
              </span>
            }
            description={(() => {
              const timeStr = formatRelativeTime(notification.timestamp);
              const paramCount =
                notification.params &&
                Object.keys(notification.params).length > 0
                  ? Object.keys(notification.params).length
                  : 0;
              const paramStr =
                paramCount > 0
                  ? ` | ${paramCount} param${paramCount > 1 ? "s" : ""}`
                  : "";
              return timeStr + paramStr;
            })()}
            onClick={() => onNotificationSelect(notification)}
          />
        );
      })}
    </div>
  );
}
