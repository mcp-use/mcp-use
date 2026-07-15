import { Button } from "@/client/components/ui/button";
import { analyzeJSON, downloadJSON } from "@/client/utils/jsonUtils";
import { highlightJson } from "@/client/utils/highlightJson";
import { Download } from "lucide-react";

interface JSONDisplayProps {
  data: any;
  filename?: string;
  className?: string;
}

const codeClassName =
  "font-mono text-[0.8rem] text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]";

export function JSONDisplay({
  data,
  filename,
  className,
  ...props
}: JSONDisplayProps) {
  const jsonInfo = analyzeJSON(data);

  const handleDownload = () => {
    downloadJSON(data, filename);
  };

  if (jsonInfo.isLarge) {
    return (
      <div className={className} {...props}>
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

        <pre className={codeClassName}>
          <code>{highlightJson(jsonInfo.preview)}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className={className} {...props}>
      <pre className={codeClassName}>
        <code>{highlightJson(jsonInfo.preview)}</code>
      </pre>
    </div>
  );
}
