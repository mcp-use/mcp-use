import {
  Brush,
  Bell,
  Check,
  Clock,
  Code,
  Copy,
  Download,
  Maximize,
  X,
} from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { JSONDisplay } from "@/client/components/shared/JSONDisplay";

export interface NotificationResult {
  method: string;
  params: any;
  timestamp: number;
  read: boolean;
  formatRelativeTime: (timestamp: number) => string;
}

interface NotificationResultDisplayProps {
  notification: NotificationResult | null;
  previewMode: boolean;
  onTogglePreview: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onFullscreen: () => void;
  onClose?: () => void;
  isCopied?: boolean;
}

export function NotificationResultDisplay({
  notification,
  previewMode,
  onTogglePreview,
  onCopy,
  onDownload,
  onFullscreen,
  isCopied = false,
  onClose,
}: NotificationResultDisplayProps) {
  if (!notification) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Bell className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">
          Select a notification to view details
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-gray-400" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {new Date(notification.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {notification.formatRelativeTime(notification.timestamp)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onTogglePreview}
            className={
              !previewMode ? "text-purple-600 dark:text-purple-400" : ""
            }
          >
            {previewMode ? (
              <Code className="h-4 w-4 mr-1" />
            ) : (
              <Brush className="h-4 w-4 mr-1" />
            )}
            {previewMode ? "JSON" : "Formatted"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCopy}>
            {isCopied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDownload}>
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onFullscreen}>
            <Maximize className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4">
          <JSONDisplay
            data={{
              method: notification.method,
              timestamp: notification.timestamp,
              read: notification.read,
              params: notification.params,
            }}
            filename={`notification-${notification.method.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.json`}
          />
        </div>
      </div>
    </div>
  );
}
