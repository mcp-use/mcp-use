import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { McpUseProvider, useWidget } from "mcp-use/react";
import { z } from "zod";
const propSchema = z.object({
  city: z.string().describe("The city name"),
  temperature: z.number().describe("Temperature in Celsius"),
  conditions: z.string().describe("Weather conditions"),
  humidity: z.number().describe("Humidity percentage"),
  windSpeed: z.number().describe("Wind speed in km/h"),
});
export const widgetMetadata = {
  description:
    "Display weather information with dual-protocol support (works with ChatGPT and MCP Apps clients)",
  props: propSchema,
  exposeAsTool: false, // Only used through custom tools
  // Using `metadata` instead of `appsSdkMetadata` automatically enables dual-protocol support!
  // No need to specify a type - the widget just works with both ChatGPT and MCP Apps clients
  metadata: {
    csp: {
      connectDomains: ["https://api.weather.com"],
      resourceDomains: [
        "https://cdn.weather.com",
        "https://soft-amber.local.mcp-use.run",
      ],
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
const WeatherDisplay = () => {
  const {
    props,
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
  // Extract values for display
  const platform = userAgent?.device?.type || "unknown";
  const hasTouch = userAgent?.capabilities?.touch || false;
  const safeAreaTop = safeArea?.insets?.top || 0;
  const safeAreaRight = safeArea?.insets?.right || 0;
  const safeAreaBottom = safeArea?.insets?.bottom || 0;
  const safeAreaLeft = safeArea?.insets?.left || 0;
  return _jsx(McpUseProvider, {
    debugger: true,
    viewControls: true,
    autoSize: true,
    children: isPending
      ? _jsx("div", {
          className: `relative rounded-3xl p-8 ${
            isDark
              ? "bg-gradient-to-br from-purple-900/20 to-violet-800/20 border border-purple-800"
              : "bg-gradient-to-br from-purple-50 to-violet-100 border border-purple-200"
          }`,
          children: _jsx("div", {
            className: "flex items-center justify-center",
            children: _jsx("div", {
              className: `animate-spin rounded-full h-12 w-12 border-b-2 ${isDark ? "border-purple-400" : "border-purple-600"}`,
            }),
          }),
        })
      : _jsxs("div", {
          className: `relative rounded-3xl p-8 ${
            isDark
              ? "bg-gradient-to-br from-purple-900/20 to-violet-800/20 border border-purple-800"
              : "bg-gradient-to-br from-purple-50 to-violet-100 border border-purple-200"
          }`,
          children: [
            _jsxs("div", {
              className: "flex items-start justify-between mb-6",
              children: [
                _jsxs("div", {
                  children: [
                    _jsx("h2", {
                      className: `text-3xl font-bold mb-1 ${isDark ? "text-white" : "text-gray-900"}`,
                      children: props.city,
                    }),
                    _jsx("p", {
                      className: `capitalize ${isDark ? "text-gray-400" : "text-gray-600"}`,
                      children: props.conditions,
                    }),
                  ],
                }),
                _jsxs("div", {
                  className: "text-right",
                  children: [
                    _jsxs("div", {
                      className: `text-5xl font-bold ${isDark ? "text-purple-400" : "text-purple-600"}`,
                      children: [props.temperature, "\u00B0"],
                    }),
                    _jsx("div", {
                      className: `text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`,
                      children: "Celsius",
                    }),
                  ],
                }),
              ],
            }),
            _jsxs("div", {
              className: `grid grid-cols-2 gap-4 pt-6 border-t ${isDark ? "border-purple-800" : "border-purple-200"}`,
              children: [
                _jsxs("div", {
                  children: [
                    _jsx("div", {
                      className: `text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`,
                      children: "Humidity",
                    }),
                    _jsxs("div", {
                      className: `text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`,
                      children: [props.humidity, "%"],
                    }),
                  ],
                }),
                _jsxs("div", {
                  children: [
                    _jsx("div", {
                      className: `text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`,
                      children: "Wind Speed",
                    }),
                    _jsxs("div", {
                      className: `text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`,
                      children: [props.windSpeed, " km/h"],
                    }),
                  ],
                }),
              ],
            }),
            _jsxs("div", {
              className: `mt-6 p-4 rounded-xl ${isDark ? "bg-black/20" : "bg-white/50"}`,
              children: [
                _jsx("p", {
                  className: `text-xs font-semibold mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`,
                  children: "Host Context Settings",
                }),
                _jsxs("div", {
                  className: "grid grid-cols-2 gap-3 text-xs",
                  children: [
                    _jsxs("div", {
                      children: [
                        _jsx("span", {
                          className: isDark ? "text-gray-500" : "text-gray-600",
                          children: "Device:",
                        }),
                        " ",
                        _jsx("span", {
                          className: isDark ? "text-gray-300" : "text-gray-800",
                          children: platform,
                        }),
                      ],
                    }),
                    _jsxs("div", {
                      children: [
                        _jsx("span", {
                          className: isDark ? "text-gray-500" : "text-gray-600",
                          children: "Locale:",
                        }),
                        " ",
                        _jsx("span", {
                          className: isDark ? "text-gray-300" : "text-gray-800",
                          children: locale,
                        }),
                      ],
                    }),
                    _jsxs("div", {
                      children: [
                        _jsx("span", {
                          className: isDark ? "text-gray-500" : "text-gray-600",
                          children: "Timezone:",
                        }),
                        " ",
                        _jsx("span", {
                          className: isDark ? "text-gray-300" : "text-gray-800",
                          children: timeZone,
                        }),
                      ],
                    }),
                    _jsxs("div", {
                      children: [
                        _jsx("span", {
                          className: isDark ? "text-gray-500" : "text-gray-600",
                          children: "Touch:",
                        }),
                        " ",
                        _jsx("span", {
                          className: isDark ? "text-gray-300" : "text-gray-800",
                          children: hasTouch ? "Yes" : "No",
                        }),
                      ],
                    }),
                    _jsxs("div", {
                      children: [
                        _jsx("span", {
                          className: isDark ? "text-gray-500" : "text-gray-600",
                          children: "Viewport:",
                        }),
                        " ",
                        _jsxs("span", {
                          className: isDark ? "text-gray-300" : "text-gray-800",
                          children: [maxWidth || "auto", "x", maxHeight],
                        }),
                      ],
                    }),
                    _jsxs("div", {
                      children: [
                        _jsx("span", {
                          className: isDark ? "text-gray-500" : "text-gray-600",
                          children: "Safe Area:",
                        }),
                        " ",
                        _jsxs("span", {
                          className: isDark ? "text-gray-300" : "text-gray-800",
                          children: [
                            safeAreaTop,
                            "/",
                            safeAreaRight,
                            "/",
                            safeAreaBottom,
                            "/",
                            safeAreaLeft,
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            _jsx("div", {
              className: `mt-4 p-3 rounded-xl ${isDark ? "bg-purple-950/30" : "bg-purple-50/50"}`,
              children: _jsxs("p", {
                className: `text-xs text-center ${isDark ? "text-gray-400" : "text-gray-600"}`,
                children: [
                  "\u2705 ",
                  _jsx("strong", { children: "METADATA PRESERVED!" }),
                  " - Deep merge ensures MCP Apps type persists",
                ],
              }),
            }),
          ],
        }),
  });
};
export default WeatherDisplay;
