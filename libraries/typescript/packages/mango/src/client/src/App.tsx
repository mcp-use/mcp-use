import React from "react";
import { motion } from "framer-motion";
import { useAppState } from "./store/app";
import { ChatPane } from "./components/chat/ChatPane";
import { HeaderTabs } from "./components/HeaderTabs";
import { CanvasViewport } from "./components/canvas/CanvasViewport";
import { EditorView } from "./components/editor/EditorView";

function App() {
  const activeTab = useAppState((state) => state.activeTab);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="h-screen w-full bg-[#EEEEEE] overflow-hidden"
    >
      {/* Header Tabs */}
      <HeaderTabs />

      {/* Chat Pane */}
      <ChatPane />

      {/* Main content area - Canvas or Editor */}
      <div className="h-full w-full pt-[70px]">
        {activeTab === "canvas" ? <CanvasViewport /> : <EditorView />}
      </div>
    </motion.div>
  );
}

export default App;
