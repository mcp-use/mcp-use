import React from "react";
import { useWidget } from "mcp-use/react";

interface FilePreviewProps {
  fileName: string;
  fileSize: string;
  preview: string;
}

export default function FilePreview({ fileName, fileSize, preview }: FilePreviewProps) {
  const { theme } = useWidget();
  const isDark = theme === "dark";

  return (
    <div className={`rounded-xl border p-4 max-w-md ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">📄</span>
        <div>
          <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>{fileName}</p>
          <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{fileSize}</p>
        </div>
      </div>
      <pre className={`text-xs font-mono p-3 rounded-lg overflow-auto max-h-48 ${isDark ? "bg-gray-900 text-gray-300" : "bg-gray-50 text-gray-700"}`}>
        {preview}
      </pre>
    </div>
  );
}
