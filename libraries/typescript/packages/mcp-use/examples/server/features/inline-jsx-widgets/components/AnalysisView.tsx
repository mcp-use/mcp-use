
interface AnalysisViewProps {
  text: string;
  analysis: string;
}

export default function AnalysisView({ text, analysis }: AnalysisViewProps) {
  return (
    <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 max-w-lg">
      <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
        Analysis
      </h3>
      <p className="text-xs text-gray-400 mb-3 truncate">Input: {text}</p>
      <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm text-gray-800 whitespace-pre-wrap min-h-[60px]">
        {analysis || (
          <span className="text-gray-400 animate-pulse">Analyzing...</span>
        )}
      </div>
    </div>
  );
}
