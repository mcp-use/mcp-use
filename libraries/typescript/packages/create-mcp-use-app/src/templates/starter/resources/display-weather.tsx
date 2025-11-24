import React from "react";
import { z } from "zod";
import { useWidget, type WidgetProps } from "mcp-use/react";
import "../styles.css";

/*
 * Apps SDK widget
 * Just export widgetMetadata with description and Zod schema, and mcp-use handles the rest!
 * See docs: https://docs.mcp-use.com/typescript/server/ui-widgets
 */

const propSchema = z.object({
  city: z.string().describe("The city to display weather for"),
  weather: z
    .enum(["sunny", "rain", "snow", "cloudy"])
    .describe("The weather condition"),
  temperature: z
    .number()
    .min(-20)
    .max(50)
    .describe("The temperature in Celsius"),
});

export const widgetMetadata = {
  description: "Display weather for a city",
  inputs: propSchema,
};

type WeatherProps = WidgetProps<z.infer<typeof propSchema>>;

const WeatherWidget: React.FC = () => {
  // Use the useWidget hook to get props from OpenAI Apps SDK
  const { props, theme } = useWidget<WeatherProps>();

  console.log(props);

  const { city, weather, temperature } = props;
  const getWeatherIcon = (weatherType: string) => {
    switch (weatherType?.toLowerCase()) {
      case "sunny":
        return "☀️";
      case "rain":
        return "🌧️";
      case "snow":
        return "❄️";
      case "cloudy":
        return "☁️";
      default:
        return "🌤️";
    }
  };

  const getWeatherColor = (weatherType: string) => {
    switch (weatherType?.toLowerCase()) {
      case "sunny":
        return "from-yellow-400 to-orange-500";
      case "rain":
        return "from-blue-400 to-blue-600";
      case "snow":
        return "from-blue-100 to-blue-300";
      case "cloudy":
        return "from-gray-400 to-gray-600";
      default:
        return "from-gray-300 to-gray-500";
    }
  };

  // Theme-aware styling
  const bgColor = theme === "dark" ? "bg-gray-900" : "bg-white";
  const textColor = theme === "dark" ? "text-gray-100" : "text-gray-800";
  const subtextColor = theme === "dark" ? "text-gray-400" : "text-gray-600";

  return (
    <div
      className={`max-w-sm mx-auto ${bgColor} rounded-xl shadow-lg overflow-hidden`}
    >
      <div
        className={`h-32 bg-gradient-to-br ${getWeatherColor(weather)} flex items-center justify-center`}
      >
        <div className="text-6xl">{getWeatherIcon(weather)}</div>
      </div>

      <div className="p-6">
        <div className="text-center">
          <h2 className={`text-2xl font-bold ${textColor} mb-2`}>{city}</h2>
          <div className="flex items-center justify-center space-x-4">
            <span className={`text-4xl font-light ${textColor}`}>
              {temperature}°
            </span>
            <div className="text-right">
              <p className={`text-lg font-medium ${subtextColor} capitalize`}>
                {weather}
              </p>
              <p className={`text-sm ${subtextColor}`}>Current</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeatherWidget;
