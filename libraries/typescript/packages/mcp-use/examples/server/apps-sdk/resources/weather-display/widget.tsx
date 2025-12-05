import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";
import "../styles.css";

const propSchema = z.object({
  city: z.string().describe("The city name"),
  temperature: z.number().describe("Temperature in Celsius"),
  conditions: z.string().describe("Weather conditions"),
  humidity: z.number().optional().describe("Humidity percentage"),
  windSpeed: z.number().optional().describe("Wind speed in km/h"),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Display weather information in a beautiful card",
  inputs: propSchema,
  // Set to false to prevent auto-registration as a tool
  // This widget will only be used through custom tools
  exposeAsTool: false,
  annotations: {
    readOnlyHint: true, // Weather display is read-only
  },
};

type WeatherProps = z.infer<typeof propSchema>;

const WeatherDisplay: React.FC = () => {
  const { props } = useWidget<WeatherProps>();

  return (
    <McpUseProvider debugger viewControls>
      <div className="relative bg-linear-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800 rounded-3xl p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
              {props.city}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 capitalize">
              {props.conditions}
            </p>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold text-blue-600 dark:text-blue-400">
              {props.temperature}°
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Celsius
            </div>
          </div>
        </div>

        {(props.humidity !== undefined || props.windSpeed !== undefined) && (
          <div className="grid grid-cols-2 gap-4 pt-6 border-t border-blue-200 dark:border-blue-800">
            {props.humidity !== undefined && (
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                  Humidity
                </div>
                <div className="text-xl font-semibold text-gray-900 dark:text-white">
                  {props.humidity}%
                </div>
              </div>
            )}
            {props.windSpeed !== undefined && (
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                  Wind Speed
                </div>
                <div className="text-xl font-semibold text-gray-900 dark:text-white">
                  {props.windSpeed} km/h
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 p-4 bg-white/50 dark:bg-black/20 rounded-xl">
          <p className="text-xs text-gray-600 dark:text-gray-400 text-center">
            This widget uses{" "}
            <code className="text-xs">exposeAsTool: false</code> and is only
            accessible through custom tools
          </p>
        </div>
      </div>
    </McpUseProvider>
  );
};

export default WeatherDisplay;
