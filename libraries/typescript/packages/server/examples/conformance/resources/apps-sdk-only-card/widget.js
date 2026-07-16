import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { McpUseProvider, useWidget } from "mcp-use/react";
import { z } from "zod";
const propSchema = z.object({
  message: z.string().optional().describe("Optional message to display"),
});
export const widgetMetadata = {
  description: "ChatGPT-only widget (Apps SDK, no MCP Apps)",
  props: propSchema,
  exposeAsTool: true,
  // appsSdkMetadata only, NO metadata → registers as type "appsSdk" (ChatGPT only)
  appsSdkMetadata: {
    "openai/widgetDescription": "A card that only works in ChatGPT (Apps SDK)",
    "openai/widgetPrefersBorder": true,
  },
};
const AppsSdkOnlyCard = () => {
  const { props, isPending, theme } = useWidget();
  const isDark = theme === "dark";
  return _jsx(McpUseProvider, {
    debugger: true,
    viewControls: true,
    autoSize: true,
    children: isPending
      ? _jsx("div", {
          className: `rounded-2xl p-8 ${isDark ? "bg-gray-800" : "bg-gray-100"}`,
          children: _jsx("div", {
            className: "animate-pulse text-center text-gray-500",
            children: "Loading...",
          }),
        })
      : _jsxs("div", {
          className: `rounded-2xl p-8 ${
            isDark
              ? "bg-gradient-to-br from-amber-900/30 to-orange-800/30 border border-amber-700"
              : "bg-gradient-to-br from-amber-50 to-orange-100 border border-amber-200"
          }`,
          children: [
            _jsx("p", {
              className: `text-sm font-medium mb-2 ${isDark ? "text-amber-400" : "text-amber-700"}`,
              children: "ChatGPT-only widget (Apps SDK)",
            }),
            _jsx("p", {
              className: `text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`,
              children:
                props.message ||
                "This widget uses appsSdkMetadata only (no metadata).",
            }),
          ],
        }),
  });
};
export default AppsSdkOnlyCard;
