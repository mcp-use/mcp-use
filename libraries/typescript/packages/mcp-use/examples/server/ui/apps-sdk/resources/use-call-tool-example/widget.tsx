import {
  McpUseProvider,
  useWidget,
  useCallTool,
  type WidgetMetadata,
} from "mcp-use/react";
import React from "react";
import { z } from "zod";
import "../../styles.css";

/**
 * Example widget demonstrating the useCallTool hook in OpenAI Apps SDK context
 *
 * In widget context, just pass the tool name directly - no server object needed!
 * The hook automatically uses window.openai.callTool under the hood.
 */

const propSchema = z.object({
  initialCity: z.string().optional().describe("Initial city to search"),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Interactive weather widget that calls MCP tools",
  props: propSchema,
  exposeAsTool: true,
  annotations: {
    title: "Weather Search Widget",
  },
};

type WidgetProps = z.infer<typeof propSchema>;

// Define types for our tool calls
type WeatherInput = {
  city: string;
  units?: "celsius" | "fahrenheit";
};

type WeatherOutput = {
  city: string;
  temperature: number;
  conditions: string;
  humidity?: number;
  windSpeed?: number;
};

type ForecastInput = { city: string; days: number };
type ForecastOutput = {
  city: string;
  forecast: Array<{
    date: string;
    temperature: number;
    conditions: string;
  }>;
};

const UseCallToolWidget: React.FC = () => {
  const { props } = useWidget<WidgetProps>();
  const [city, setCity] = React.useState(props.initialCity || "Paris");
  const [history, setHistory] = React.useState<string[]>([]);

  // ============================================================
  // Widget context - just pass tool name directly!
  // The hook auto-detects window.openai.callTool
  // ============================================================

  const weatherHook = useCallTool<WeatherInput, WeatherOutput>(
    "get-weather", // Just the tool name - no server object needed!
    {
      onSuccess: (data, input) => {
        console.log(`Weather for ${input.city}:`, data);
        if (!history.includes(input.city)) {
          setHistory((prev) => [input.city, ...prev].slice(0, 5));
        }
      },
      onError: (error, input) => {
        console.error(`Failed to get weather for ${input.city}:`, error);
      },
    }
  );

  const forecastHook = useCallTool<ForecastInput, ForecastOutput>(
    "get-forecast" // Another tool
  );

  // Handler for searching weather
  const handleSearch = () => {
    if (city.trim()) {
      weatherHook.callTool({ city: city.trim() });
    }
  };

  // Handler for getting forecast (async pattern)
  const handleGetForecast = async () => {
    try {
      const result = await forecastHook.callToolAsync({ city, days: 5 });
      console.log("Forecast:", result);
    } catch (error) {
      console.error("Forecast error:", error);
    }
  };

  // Handler for city from history
  const handleHistoryClick = (historicalCity: string) => {
    setCity(historicalCity);
    weatherHook.callTool({ city: historicalCity });
  };

  return (
    <McpUseProvider debugger viewControls>
      <div className="relative bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-900/20 dark:to-indigo-800/20 border border-blue-200 dark:border-blue-800 rounded-3xl p-6">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Weather Search
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Widget context: <code>useCallTool('tool-name')</code>
          </p>
        </div>

        {/* Search Input */}
        <div className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Enter city name..."
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={weatherHook.isPending}
            />
            <button
              onClick={handleSearch}
              disabled={weatherHook.isPending || !city.trim()}
              className={`px-6 py-2 rounded-lg font-medium text-white transition-colors
                ${
                  weatherHook.isPending || !city.trim()
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
                }`}
            >
              {weatherHook.isPending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Loading
                </span>
              ) : (
                "Search"
              )}
            </button>
          </div>

          {/* Loading States Indicator */}
          <div className="mt-2 flex gap-3 text-xs">
            <span
              className={`px-2 py-1 rounded ${
                weatherHook.isIdle
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600"
              }`}
            >
              Idle
            </span>
            <span
              className={`px-2 py-1 rounded ${
                weatherHook.isPending
                  ? "bg-yellow-200 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600"
              }`}
            >
              Pending
            </span>
            <span
              className={`px-2 py-1 rounded ${
                weatherHook.isSuccess
                  ? "bg-green-200 dark:bg-green-900 text-green-800 dark:text-green-200"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600"
              }`}
            >
              Success
            </span>
            <span
              className={`px-2 py-1 rounded ${
                weatherHook.isError
                  ? "bg-red-200 dark:bg-red-900 text-red-800 dark:text-red-200"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600"
              }`}
            >
              Error
            </span>
          </div>
        </div>

        {/* Success Result */}
        {weatherHook.isSuccess && weatherHook.data && (
          <div className="mb-6 p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {weatherHook.data.city}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 capitalize">
                  {weatherHook.data.conditions}
                </p>
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                  {weatherHook.data.temperature}°
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Celsius
                </div>
              </div>
            </div>

            {(weatherHook.data.humidity !== undefined ||
              weatherHook.data.windSpeed !== undefined) && (
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                {weatherHook.data.humidity !== undefined && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Humidity
                    </div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {weatherHook.data.humidity}%
                    </div>
                  </div>
                )}
                {weatherHook.data.windSpeed !== undefined && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Wind Speed
                    </div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {weatherHook.data.windSpeed} km/h
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={handleGetForecast}
                disabled={forecastHook.isPending}
                className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg 
                         disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {forecastHook.isPending ? "Loading..." : "Get 5-Day Forecast"}
              </button>
              <button
                onClick={weatherHook.reset}
                className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 
                         dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Error Display */}
        {weatherHook.isError && weatherHook.error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
            <h4 className="font-semibold text-red-800 dark:text-red-200 mb-2">
              Error
            </h4>
            <p className="text-sm text-red-700 dark:text-red-300">
              {weatherHook.error.message}
            </p>
            <button
              onClick={weatherHook.reset}
              className="mt-3 px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Forecast Result */}
        {forecastHook.isSuccess && forecastHook.data && (
          <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-900 dark:text-white">
                5-Day Forecast for {forecastHook.data.city}
              </h4>
              <button
                onClick={forecastHook.reset}
                className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 
                         dark:hover:bg-gray-600 rounded transition-colors"
              >
                Close
              </button>
            </div>
            <div className="space-y-2">
              {forecastHook.data.forecast.map((day, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded"
                >
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {day.date}
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {day.conditions}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {day.temperature}°C
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search History */}
        {history.length > 0 && (
          <div className="p-4 bg-white/50 dark:bg-black/20 rounded-xl">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Recent Searches
            </h4>
            <div className="flex flex-wrap gap-2">
              {history.map((historicalCity) => (
                <button
                  key={historicalCity}
                  onClick={() => handleHistoryClick(historicalCity)}
                  disabled={weatherHook.isPending}
                  className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 
                           dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {historicalCity}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Info Footer */}
        <div className="mt-6 p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg">
          <p className="text-xs text-gray-600 dark:text-gray-400 text-center">
            In widgets, just pass the tool name:{" "}
            <code>useCallTool('get-weather')</code>
          </p>
        </div>
      </div>
    </McpUseProvider>
  );
};

export default UseCallToolWidget;
