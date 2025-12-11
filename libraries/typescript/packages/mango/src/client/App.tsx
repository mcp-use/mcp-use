import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CanvasPanel } from "./components/canvas/CanvasPanel.js";
import { ChatPanel } from "./components/chat/ChatPanel.js";
import { MangoProvider, useMangoContext } from "./context/MangoContext.js";

/**
 * Main app layout with chat and canvas
 */
function AppContent() {
  const { primitives, connection } = useMangoContext();

  return (
    <div className="h-screen w-screen overflow-hidden">
      <PanelGroup direction="horizontal">
        <Panel defaultSize={40} minSize={30}>
          <ChatPanel />
        </Panel>

        <PanelResizeHandle className="w-1 bg-gray-300 dark:bg-gray-700 hover:bg-blue-500 transition-colors" />

        <Panel defaultSize={60} minSize={30}>
          <CanvasPanel
            primitives={primitives}
            projectName={connection?.projectName}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}

/**
 * Main app component with provider
 */
export function App() {
  return (
    <MangoProvider>
      <AppContent />
    </MangoProvider>
  );
}
