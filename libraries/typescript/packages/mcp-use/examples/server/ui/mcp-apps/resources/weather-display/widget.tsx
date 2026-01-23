import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";

const propSchema = z.object({
  city: z.string().describe("The city name"),
  temperature: z.number().describe("Temperature in Celsius"),
  conditions: z.string().describe("Weather conditions"),
  humidity: z.number().describe("Humidity percentage"),
  windSpeed: z.number().describe("Wind speed in km/h"),
});

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display weather information with dual-protocol support (works with ChatGPT and MCP Apps clients)",
  props: propSchema,
  exposeAsTool: false, // Only used through custom tools
  // Using `metadata` instead of `appsSdkMetadata` automatically enables dual-protocol support!
  // No need to specify a type - the widget just works with both ChatGPT and MCP Apps clients
  metadata: {
    csp: {
      connectDomains: ["https://api.weather.com"],
      resourceDomains: ["https://cdn.weather.com"],
      scriptDirectives: ["'unsafe-eval'"], // Required for React runtime (eval in bundles)
    },
    prefersBorder: true,
    autoResize: true, // MCP Apps clients will use this
    widgetDescription:
      "Interactive weather card showing temperature and conditions", // ChatGPT will use this
  },
  annotations: {
    readOnlyHint: true,
  },
};

type WeatherProps = z.infer<typeof propSchema>;

const WeatherDisplay: React.FC = () => {
  const { props, isPending, theme } = useWidget<WeatherProps>();

  const isDark = theme === "dark";

  return (
    <McpUseProvider debugger viewControls>
      {isPending ? (
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
            ></div>
          </div>
        </div>
      ) : (
        <div
          className={`relative rounded-3xl p-8 ${
            isDark
              ? "bg-gradient-to-br from-purple-900/20 to-violet-800/20 border border-purple-800"
              : "bg-gradient-to-br from-purple-50 to-violet-100 border border-purple-200"
          }`}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2
                className={`text-3xl font-bold mb-1 ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                {props.city}
              </h2>
              <p
                className={`capitalize ${
                  isDark ? "text-gray-400" : "text-gray-600"
                }`}
              >
                {props.conditions}
              </p>
            </div>
            <div className="text-right">
              <div
                className={`text-5xl font-bold ${
                  isDark ? "text-purple-400" : "text-purple-600"
                }`}
              >
                {props.temperature}°
              </div>
              <div
                className={`text-sm ${
                  isDark ? "text-gray-400" : "text-gray-500"
                }`}
              >
                Celsius
              </div>
            </div>
          </div>

          {/* Details Grid */}
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
                {props.humidity}%
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
                {props.windSpeed} km/h
              </div>
            </div>
          </div>

          {/* Info Badge */}
          <div
            className={`mt-6 p-4 rounded-xl ${
              isDark ? "bg-black/20" : "bg-white/50"
            }`}
          >
            <p
              className={`text-xs text-center ${
                isDark ? "text-gray-400" : "text-gray-600"
              }`}
            >
              ✨ <strong>MCP Apps Widget</strong> - Works with both ChatGPT and
              MCP Apps clients
            </p>
          </div>
        </div>
      )}
    </McpUseProvider>
  );
};

export default WeatherDisplay;
