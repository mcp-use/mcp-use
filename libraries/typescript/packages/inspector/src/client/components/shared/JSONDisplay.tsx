import { Button } from "@/client/components/ui/button";
import { analyzeJSON, downloadJSON, getJsonDisplayData } from "@/client/utils/jsonUtils";
import { highlightJson } from "@/client/utils/highlightJson";
import { Download } from "lucide-react";
import { CollapsibleJSON } from "./CollapsibleJSON";

interface JSONDisplayProps {
  data: any;
  filename?: string;
  className?: string;
  /** Render as an expandable/collapsible tree. */
  collapsible?: boolean;
  /** Initial expand state for collapsible trees. Default: true. */
  defaultExpanded?: boolean;
}

const codeClassName =
  "font-mono text-[0.8rem] text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]";

export function JSONDisplay({
  data,
  filename,
  className,
  collapsible = false,
  defaultExpanded = true,
  ...props
}: JSONDisplayProps) {
  const jsonInfo = analyzeJSON(data);
  const displayData = getJsonDisplayData(data);

  const handleDownload = () => {
    downloadJSON(data, filename);
  };

  const largeBanner = jsonInfo.isLarge ? (
    <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
            JSON is too large ({jsonInfo.sizeFormatted})
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-400">
            Showing full structure with truncated values. Download the full JSON
            file to see complete values.
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
  ) : null;

  if (collapsible) {
    return (
      <div className={className} {...props}>
        {largeBanner}
        <CollapsibleJSON
          data={displayData}
          defaultExpanded={defaultExpanded}
        />
      </div>
    );
  }

  if (jsonInfo.isLarge) {
    return (
      <div className={className} {...props}>
        {largeBanner}
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
