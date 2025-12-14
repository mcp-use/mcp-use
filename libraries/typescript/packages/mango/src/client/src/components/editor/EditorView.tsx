import { useState } from "react";
import { useAppState } from "../../store/app";
import { useChatStream } from "../../hooks/useChatStream";
import { FileExplorer } from "./FileExplorer";
import { CodeEditor } from "./CodeEditor";

export function EditorView() {
  const selectedFile = useAppState((state) => state.selectedFile);
  const setSelectedFile = useAppState((state) => state.setSelectedFile);
  const chatWidth = useAppState((state) => state.chatWidth);
  const { conversationId } = useChatStream();

  return (
    <div
      className="h-full w-full flex ml-auto"
      style={{ width: `calc(100% - ${chatWidth + 64}px)` }}
    >
      {/* File Explorer */}
      <div className="w-64 flex-shrink-0">
        <FileExplorer
          conversationId={conversationId}
          onFileSelect={setSelectedFile}
          selectedFile={selectedFile}
        />
      </div>

      {/* Code Editor */}
      <div className="flex-1">
        <CodeEditor filePath={selectedFile} conversationId={conversationId} />
      </div>
    </div>
  );
}
