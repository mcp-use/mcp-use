import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";

const propSchema = z.object({
  message: z.string().optional().describe("Optional message to display"),
});

export const widgetMetadata: WidgetMetadata = {
  description: "ChatGPT-only widget (Apps SDK, no MCP Apps)",
  props: propSchema,
  exposeAsTool: true,
  // appsSdkMetadata only, NO metadata → registers as type "appsSdk" (ChatGPT only)
  appsSdkMetadata: {
    "openai/widgetDescription": "A card that only works in ChatGPT (Apps SDK)",
    "openai/widgetPrefersBorder": true,
  },
};

type AppsSdkOnlyCardProps = z.infer<typeof propSchema>;

const AppsSdkOnlyCard: React.FC = () => {
  const { props, isPending, theme } = useWidget<AppsSdkOnlyCardProps>();
  const isDark = theme === "dark";

  return (
    <McpUseProvider debugger viewControls autoSize>
      {isPending ? (
        <div
          className={`rounded-2xl p-8 ${
            isDark ? "bg-gray-800" : "bg-gray-100"
          }`}
        >
          <div className="animate-pulse text-center text-gray-500">
            Loading...
          </div>
        </div>
      ) : (
        <div
          className={`rounded-2xl p-8 ${
            isDark
              ? "bg-gradient-to-br from-amber-900/30 to-orange-800/30 border border-amber-700"
              : "bg-gradient-to-br from-amber-50 to-orange-100 border border-amber-200"
          }`}
        >
          <p
            className={`text-sm font-medium mb-2 ${
              isDark ? "text-amber-400" : "text-amber-700"
            }`}
          >
            ChatGPT-only widget (Apps SDK)
          </p>
          <p
            className={`text-lg font-semibold ${
              isDark ? "text-white" : "text-gray-900"
            }`}
          >
            {props.message ||
              "This widget uses appsSdkMetadata only (no metadata)."}
          </p>
        </div>
      )}
    </McpUseProvider>
  );
};

export default AppsSdkOnlyCard;
