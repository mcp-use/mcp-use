import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";
import "../styles.css";

const propSchema = z.object({
  name: z.string().describe("Name to greet"),
  greeting: z.string().describe("Greeting message"),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Display a personalized greeting message",
  props: propSchema,
  exposeAsTool: false,
  metadata: {
    prefersBorder: false,
    widgetDescription: "A colorful greeting card with personalized message",
  },
  annotations: {
    readOnlyHint: true,
  },
};

type GreetingProps = z.infer<typeof propSchema>;

const GreetingCard: React.FC = () => {
  const { props, isPending } = useWidget<GreetingProps>();

  return (
    <McpUseProvider debugger viewControls autoSize>
      <div className="flex items-center justify-center min-h-[260px] p-6 bg-zinc-900/5 dark:bg-zinc-950 transition-colors duration-300">
        <div className="w-full max-w-[380px] rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-950 text-zinc-400 font-mono shadow-2xl overflow-hidden text-left">
          {/* Header */}
          <div className="px-4 py-2.5 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200/80 dark:border-zinc-800/80 select-none">
            <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
              greeting-card
            </span>
          </div>

          {/* Terminal Body */}
          <div className="p-5 flex flex-col gap-1.5 bg-zinc-950">
            {isPending ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-zinc-500 animate-pulse">
                  <span>Executing...</span>
                </div>
              </div>
            ) : (
              <>
                {/* Greeting Line */}
                <div className="text-lg font-bold text-zinc-100 leading-tight">
                  {props.greeting}
                </div>
                {/* Name Line */}
                <div className="text-lg font-bold text-zinc-100 leading-tight">
                  {props.name}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </McpUseProvider>
  );
};

export default GreetingCard;
