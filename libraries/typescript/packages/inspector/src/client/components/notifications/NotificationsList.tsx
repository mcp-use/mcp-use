import type { McpNotification } from "@mcp-use/client/react";

// Type alias for backward compatibility
type MCPNotification = McpNotification;
import { ListItem } from "@/client/components/shared/ListItem";
import { NotFound } from "@/client/components/ui/not-found";

interface NotificationsListProps {
  notifications: MCPNotification[];
  selectedNotification: MCPNotification | null;
  onNotificationSelect: (notification: MCPNotification) => void;
  focusedIndex: number;
  formatRelativeTime: (timestamp: number) => string;
}

export function NotificationsList({
  notifications,
  selectedNotification,
  onNotificationSelect,
  focusedIndex,
  formatRelativeTime,
}: NotificationsListProps) {
  if (notifications.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <NotFound vertical noBorder message="No notifications yet" />
      </div>
    );
  }

  return (
    <div>
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
