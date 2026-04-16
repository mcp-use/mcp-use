import React from "react";
import { useCallTool, useWidget } from "mcp-use/react";
import type { ToolRef } from "mcp-use/react";

interface WeatherCardProps {
  city?: string;
  temperature?: number;
  conditions?: string;
  humidity?: number;
}

export default function WeatherCard({ city, temperature, conditions, humidity }: WeatherCardProps) {
  const { theme, displayMode, requestDisplayMode, sendFollowUpMessage, openExternal, isPending } =
    useWidget();
  const echoRef = { name: "echo" } as ToolRef<"echo", { message: string }>;
  const { callTool: callEcho, data: echoData, isPending: echoLoading } = useCallTool(echoRef);
  const isDark = theme === "dark";

  if (isPending || city === undefined || temperature === undefined) {
    return (
      <div
        className={`rounded-xl overflow-hidden shadow-lg max-w-sm min-h-[220px] animate-pulse ${
          isDark ? "bg-gray-700" : "bg-blue-200"
        }`}
      />
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden shadow-lg max-w-sm text-white`}>
      <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-2xl font-bold">{city}</h2>
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{displayMode}</span>
        </div>
        <p className="text-5xl font-light mb-3">{temperature}°C</p>
        <div className="flex items-center gap-4 text-blue-100">
          <span className="capitalize">{conditions}</span>
          <span>·</span>
          <span>{humidity}% humidity</span>
        </div>
      </div>
      <div className={`p-3 flex flex-wrap gap-2 text-xs ${isDark ? "bg-gray-800" : "bg-gray-50"}`}>
        <button onClick={() => requestDisplayMode(displayMode === "inline" ? "fullscreen" : "inline")} className="px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">
          {displayMode === "inline" ? "⛶ Fullscreen" : "↙ Inline"}
        </button>
        <button onClick={() => sendFollowUpMessage(`Weather in ${city}: ${temperature}°C, ${conditions}.`)} className="px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200">
          💬 Send to chat
        </button>
        <button onClick={() => openExternal(`https://www.google.com/search?q=weather+${encodeURIComponent(city)}`)} className="px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200">
          🔗 Google weather
        </button>
        <button onClick={() => callEcho({ message: `Weather in ${city}: ${temperature}°C` })} className="px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200" disabled={echoLoading}>
          {echoLoading ? "⏳" : "📡"} Call echo tool
        </button>
      </div>
      {echoData && (
        <div className={`px-3 pb-3 text-xs ${isDark ? "bg-gray-800 text-gray-400" : "bg-gray-50 text-gray-500"}`}>
          Echo: {echoData.result}
        </div>
      )}
    </div>
  );
}
