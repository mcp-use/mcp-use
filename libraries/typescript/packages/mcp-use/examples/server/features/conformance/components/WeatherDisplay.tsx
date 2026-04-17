import { McpUseProvider, useWidget } from "mcp-use/react";
import React from "react";

export interface WeatherDisplayProps {
  city?: string;
  temperature?: number;
  conditions?: string;
  humidity?: number;
  windSpeed?: number;
}

/**
 * Inline JSX root: structured fields arrive as props; host/runtime from useWidget().
 */
const WeatherDisplay: React.FC<WeatherDisplayProps> = ({
  city,
  temperature,
  conditions,
  humidity,
  windSpeed,
}) => {
  const {
    isPending,
    theme,
    locale,
    timeZone,
    maxWidth,
    maxHeight,
    userAgent,
    safeArea,
  } = useWidget();

  const isDark = theme === "dark";

  const platform = userAgent?.device?.type || "unknown";
  const hasTouch = userAgent?.capabilities?.touch || false;
  const safeAreaTop = safeArea?.insets?.top || 0;
  const safeAreaRight = safeArea?.insets?.right || 0;
  const safeAreaBottom = safeArea?.insets?.bottom || 0;
  const safeAreaLeft = safeArea?.insets?.left || 0;

  if (isPending || city === undefined || temperature === undefined) {
    return (
      <McpUseProvider debugger viewControls autoSize>
        <div
          className={`relative rounded-3xl p-8 ${
            isDark
              ? "bg-gradient-to-br from-purple-900/20 to-violet-800/20 border border-purple-800"
              : "bg-gradient-to-br from-purple-50 to-violet-100 border border-purple-200"
          }`}
        >
          <div className="flex items-center justify-center">
            <div
              className={`animate-spin rounded-full h-12 w-12 border-b-2 ${
                isDark ? "border-purple-400" : "border-purple-600"
              }`}
            />
          </div>
        </div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider debugger viewControls autoSize>
      <div
        className={`relative rounded-3xl p-8 ${
          isDark
            ? "bg-gradient-to-br from-purple-900/20 to-violet-800/20 border border-purple-800"
            : "bg-gradient-to-br from-purple-50 to-violet-100 border border-purple-200"
        }`}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2
              className={`text-3xl font-bold mb-1 ${
                isDark ? "text-white" : "text-gray-900"
              }`}
            >
              {city}
            </h2>
            <p
              className={`capitalize ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {conditions}
            </p>
          </div>
          <div className="text-right">
            <div
              className={`text-5xl font-bold ${
                isDark ? "text-purple-400" : "text-purple-600"
              }`}
            >
              {temperature}°
            </div>
            <div
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              Celsius
            </div>
          </div>
        </div>

        <div
          className={`grid grid-cols-2 gap-4 pt-6 border-t ${
            isDark ? "border-purple-800" : "border-purple-200"
          }`}
        >
          <div>
            <div
              className={`text-sm mb-1 ${
                isDark ? "text-gray-400" : "text-gray-500"
              }`}
            >
              Humidity
            </div>
            <div
              className={`text-xl font-semibold ${
                isDark ? "text-white" : "text-gray-900"
              }`}
            >
              {humidity}%
            </div>
          </div>
          <div>
            <div
              className={`text-sm mb-1 ${
                isDark ? "text-gray-400" : "text-gray-500"
              }`}
            >
              Wind Speed
            </div>
            <div
              className={`text-xl font-semibold ${
                isDark ? "text-white" : "text-gray-900"
              }`}
            >
              {windSpeed} km/h
            </div>
          </div>
        </div>

        <div
          className={`mt-6 p-4 rounded-xl ${isDark ? "bg-black/20" : "bg-white/50"}`}
        >
          <p
            className={`text-xs font-semibold mb-3 ${
              isDark ? "text-gray-300" : "text-gray-700"
            }`}
          >
            Host Context Settings
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className={isDark ? "text-gray-500" : "text-gray-600"}>
                Device:
              </span>{" "}
              <span className={isDark ? "text-gray-300" : "text-gray-800"}>
                {platform}
              </span>
            </div>
            <div>
              <span className={isDark ? "text-gray-500" : "text-gray-600"}>
                Locale:
              </span>{" "}
              <span className={isDark ? "text-gray-300" : "text-gray-800"}>
                {locale}
              </span>
            </div>
            <div>
              <span className={isDark ? "text-gray-500" : "text-gray-600"}>
                Timezone:
              </span>{" "}
              <span className={isDark ? "text-gray-300" : "text-gray-800"}>
                {timeZone}
              </span>
            </div>
            <div>
              <span className={isDark ? "text-gray-500" : "text-gray-600"}>
                Touch:
              </span>{" "}
              <span className={isDark ? "text-gray-300" : "text-gray-800"}>
                {hasTouch ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className={isDark ? "text-gray-500" : "text-gray-600"}>
                Viewport:
              </span>{" "}
              <span className={isDark ? "text-gray-300" : "text-gray-800"}>
                {maxWidth || "auto"}x{maxHeight}
              </span>
            </div>
            <div>
              <span className={isDark ? "text-gray-500" : "text-gray-600"}>
                Safe Area:
              </span>{" "}
              <span className={isDark ? "text-gray-300" : "text-gray-800"}>
                {safeAreaTop}/{safeAreaRight}/{safeAreaBottom}/{safeAreaLeft}
              </span>
            </div>
          </div>
        </div>

        <div
          className={`mt-4 p-3 rounded-xl ${
            isDark ? "bg-purple-950/30" : "bg-purple-50/50"
          }`}
        >
          <p
            className={`text-xs text-center ${
              isDark ? "text-gray-400" : "text-gray-600"
            }`}
          >
            Dual-protocol MCP Apps + ChatGPT — structured props from inline JSX tool
            returns; host APIs from <code className="text-xs">useWidget()</code>
          </p>
        </div>
      </div>
    </McpUseProvider>
  );
};

export default WeatherDisplay;
