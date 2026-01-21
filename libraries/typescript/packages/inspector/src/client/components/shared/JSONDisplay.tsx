import { Button } from "@/client/components/ui/button";
import { usePrismTheme } from "@/client/hooks/usePrismTheme";
import { analyzeJSON, downloadJSON } from "@/client/utils/jsonUtils";
import { Download } from "lucide-react";
import { LightAsync as SyntaxHighlighter } from "react-syntax-highlighter";

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
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                JSON is too large ({jsonInfo.sizeFormatted})
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400">
                Showing full structure with truncated values. Download the full
                JSON file to see complete values.
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

        <SyntaxHighlighter
          language="json"
          style={prismStyle}
          wrapLongLines
          codeTagProps={{
            style: {
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              fontSize: "0.8rem",
            },
          }}
          customStyle={{
            margin: 0,
            padding: 0,
            border: "none",
            borderRadius: 0,
            fontSize: "0.8rem",
            background: "transparent",
            overflowX: "hidden",
          }}
          className="text-gray-900 dark:text-gray-100"
        >
          {jsonInfo.preview}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <div className={className}>
      <SyntaxHighlighter
        language="json"
        style={prismStyle}
        wrapLongLines
        codeTagProps={{
          style: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          },
        }}
        customStyle={{
          margin: 0,
          padding: 0,
          border: "none",
          borderRadius: 0,
          fontSize: "0.8rem",
          background: "transparent",
          overflowX: "hidden",
        }}
        className="text-gray-900 dark:text-gray-100"
      >
        {jsonInfo.preview}
      </SyntaxHighlighter>
    </div>
  );
}
