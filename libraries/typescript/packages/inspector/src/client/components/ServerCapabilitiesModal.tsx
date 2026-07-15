import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import type { McpServer } from "@mcp-use/client/react";
import { inspectorSettingsContentClass } from "@/client/lib/inspector-settings-layout";
import { ServerMetadataPanel } from "./ServerMetadataPanel";

type MCPConnection = McpServer;

interface ServerCapabilitiesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: MCPConnection | null;
}

export function ServerCapabilitiesModal({
  open,
  onOpenChange,
  connection,
}: ServerCapabilitiesModalProps) {
  if (!connection) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        scrollable
        className="max-w-4xl max-h-[80vh]"
        data-testid="server-info-modal"
      >
        <DialogHeader sticky>
          <DialogTitle data-testid="server-info-modal-title">
            Server Information
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className={inspectorSettingsContentClass}>
            <ServerMetadataPanel connection={connection} inDialog />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
