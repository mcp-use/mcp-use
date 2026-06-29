import { useView } from "mcp-use/react";

interface AnalysisViewProps {
  text?: string;
  analysis?: string;
  streamedProp1?: string;
}

interface AnalysisToolInput {
  text?: string;
  streamedProp1?: string;
  streamedProp2?: string;
}

export default function AnalysisView({
  text,
  analysis,
  streamedProp1,
}: AnalysisViewProps) {
  const { isPending, toolInput } = useView<AnalysisToolInput>();
  const streamedProp2 = toolInput?.streamedProp2;

  return (
    <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
          Analysis
        </h3>
        {isPending ? (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 animate-pulse">
            tool running…
          </span>
        ) : (
          <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
            tool done
          </span>
        )}
      </div>

      <p className="text-xs text-gray-400 truncate">Input: {text || "…"}</p>

      <Row
        label="streamedProp1"
        source="direct JSX prop (toolInput → props)"
        value={streamedProp1}
        timing="immediate"
      />

      <Row
        label="streamedProp2"
        source="useView().toolInput"
        value={streamedProp2}
        timing="immediate"
      />

      <Row
        label="analysis"
        source="server streamable (notifications)"
        value={analysis}
        timing="streaming"
      />

      <Row
        label="tool output"
        source="CallToolResult (handler return)"
        value={isPending ? undefined : "Analysis complete"}
        timing="pending"
        pending={isPending}
      />
    </div>
  );
}

function Row({
  label,
  source,
  value,
  timing,
  pending,
}: {
  label: string;
  source: string;
  value?: string;
  timing: "immediate" | "streaming" | "pending";
  pending?: boolean;
}) {
  const showPlaceholder =
    value === undefined ||
    value === "" ||
    (timing === "pending" && pending === true);
  const placeholder =
    timing === "pending"
      ? "waiting for tool to finish…"
      : timing === "streaming"
        ? "streaming…"
        : "…";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">
          {source}
        </span>
      </div>
      <div className="mt-1 bg-gray-50 rounded-lg p-3 font-mono text-sm text-gray-800 whitespace-pre-wrap min-h-[32px]">
        {showPlaceholder ? (
          <span className="text-gray-400 animate-pulse">{placeholder}</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
