import { lazy, Suspense, type ReactNode } from "react";
import { Spinner } from "@/client/components/ui/spinner";

export const ChatTab = lazy(() =>
  import("./ChatTab").then((m) => ({ default: m.ChatTab }))
);
export const ToolsTab = lazy(() =>
  import("./ToolsTab").then((m) => ({ default: m.ToolsTab }))
);
export const PromptsTab = lazy(() =>
  import("./PromptsTab").then((m) => ({ default: m.PromptsTab }))
);
export const ResourcesTab = lazy(() =>
  import("./ResourcesTab").then((m) => ({ default: m.ResourcesTab }))
);
export const SamplingTab = lazy(() =>
  import("./SamplingTab").then((m) => ({ default: m.SamplingTab }))
);
export const ElicitationTab = lazy(() =>
  import("./ElicitationTab").then((m) => ({ default: m.ElicitationTab }))
);
export const NotificationsTab = lazy(() =>
  import("./NotificationsTab").then((m) => ({ default: m.NotificationsTab }))
);
export const ServerMetadataTab = lazy(() =>
  import("./ServerMetadataTab").then((m) => ({ default: m.ServerMetadataTab }))
);
export const ConnectionSettingsTab = lazy(() =>
  import("./ConnectionSettingsTab").then((m) => ({
    default: m.ConnectionSettingsTab,
  }))
);

/** Suspense boundary for lazily loaded inspector tabs. */
export function TabSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner className="size-6" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
