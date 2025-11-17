import { Download } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { Button } from "@/client/components/ui/button";
import { usePrismTheme } from "@/client/hooks/usePrismTheme";
import { analyzeJSON, downloadJSON } from "@/client/utils/jsonUtils";

interface JSONDisplayProps {
  data: any;
  filename?: string;
  className?: string;
}

export function JSONDisplay({ data, filename, className }: JSONDisplayProps) {
  const { prismStyle } = usePrismTheme();
  const jsonInfo = analyzeJSON(data);

  const handleDownload = () => {
    downloadJSON(data, filename);
  };

  if (jsonInfo.isLarge) {
    return (
      <div className={className}>
        <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                JSON is too large ({jsonInfo.sizeFormatted})
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400">
                Showing preview only. Download the full JSON file to inspect it
                completely.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="shrink-0"
            >
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Preview (first {formatBytes(jsonInfo.preview.length)} of{" "}
          {jsonInfo.sizeFormatted}):
        </div>
        <SyntaxHighlighter
          language="json"
          style={prismStyle}
          customStyle={{
            margin: 0,
            padding: 0,
            border: "none",
            borderRadius: 0,
            fontSize: "1rem",
            background: "transparent",
          }}
          className="text-gray-900 dark:text-gray-100"
        >
          {jsonInfo.preview + "\n\n... (truncated)"}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <div className={className}>
      <SyntaxHighlighter
        language="json"
        style={prismStyle}
        customStyle={{
          margin: 0,
          padding: 0,
          border: "none",
          borderRadius: 0,
          fontSize: "1rem",
          background: "transparent",
        }}
        className="text-gray-900 dark:text-gray-100"
      >
        {jsonInfo.preview}
      </SyntaxHighlighter>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}
