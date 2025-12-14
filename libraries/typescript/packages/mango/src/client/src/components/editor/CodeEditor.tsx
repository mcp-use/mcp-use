import { useEffect, useState, useCallback } from "react";
import { Save, AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "../../lib/utils";

interface CodeEditorProps {
  filePath: string | null;
  conversationId: string;
}

export function CodeEditor({ filePath, conversationId }: CodeEditorProps) {
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [hasChanges, setHasChanges] = useState(false);
  const [originalContent, setOriginalContent] = useState("");

  // Load file content
  useEffect(() => {
    if (!filePath || !conversationId) {
      setContent("");
      setOriginalContent("");
      setHasChanges(false);
      return;
    }

    const loadFile = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/files/content?conversationId=${conversationId}&filePath=${encodeURIComponent(filePath)}`
        );
        const data = await response.json();

        if (data.content !== undefined) {
          setContent(data.content);
          setOriginalContent(data.content);
          setHasChanges(false);
          setSaveStatus("idle");
        } else if (data.error) {
          console.error("Error loading file:", data.error);
          if (!data.error.includes("Sandbox not found")) {
            setSaveStatus("error");
          }
        }
      } catch (error) {
        console.error("Error loading file:", error);
        setSaveStatus("error");
      } finally {
        setIsLoading(false);
      }
    };

    loadFile();
  }, [filePath, conversationId]);

  // Track changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      setHasChanges(newContent !== originalContent);
      if (saveStatus === "saved") {
        setSaveStatus("idle");
      }
    },
    [originalContent, saveStatus]
  );

  // Save file
  const handleSave = useCallback(async () => {
    if (!filePath || !conversationId || !hasChanges) return;

    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const response = await fetch(
        `/api/files/save?conversationId=${conversationId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filePath,
            content,
          }),
        }
      );

      const data = await response.json();

      if (data.success) {
        setOriginalContent(content);
        setHasChanges(false);
        setSaveStatus("saved");
        setTimeout(() => {
          if (saveStatus === "saved") {
            setSaveStatus("idle");
          }
        }, 3000);
      } else {
        setSaveStatus("error");
      }
    } catch (error) {
      console.error("Error saving file:", error);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  }, [filePath, conversationId, content, hasChanges, saveStatus]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasChanges) {
          handleSave();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasChanges, handleSave]);

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <div className="text-center">
          <FileCode className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Select a file to edit</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-gray-300 border-t-gray-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading file...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Editor Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-900">{filePath}</h3>
          {hasChanges && (
            <span className="text-xs text-orange-600 font-medium">
              (unsaved changes)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === "saved" && (
            <div className="flex items-center gap-1.5 text-green-600 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>Saved</span>
            </div>
          )}
          {saveStatus === "error" && (
            <div className="flex items-center gap-1.5 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>Error saving</span>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors",
              hasChanges
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            <Save className="w-4 h-4" />
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          className="w-full h-full p-4 font-mono text-sm text-gray-800 resize-none focus:outline-none bg-white"
          spellCheck={false}
          style={{
            lineHeight: "1.6",
            tabSize: 2,
          }}
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Synced to E2B sandbox</span>
          <span>
            {content.split("\n").length} lines • {content.length} characters
          </span>
        </div>
      </div>
    </div>
  );
}

function FileCode({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}
