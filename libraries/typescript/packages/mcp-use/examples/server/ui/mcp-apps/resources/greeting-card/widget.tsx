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
    prefersBorder: true,
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
      <div className="flex items-center justify-center min-h-[240px] p-4">
        {isPending ? (
          <div className="rounded-3xl border border-pink-200/70 bg-gradient-to-br from-pink-100 to-rose-200 px-8 py-10 shadow-lg shadow-pink-200/40 dark:border-pink-500/30 dark:from-pink-950/40 dark:to-rose-900/40">
            <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-pink-600 dark:border-pink-300" />
          </div>
        ) : (
          <div className="min-w-[360px] rounded-3xl border border-pink-200/70 bg-gradient-to-br from-fuchsia-400 via-pink-500 to-rose-500 px-10 py-12 text-center text-white shadow-2xl shadow-pink-500/30 dark:border-pink-500/30 dark:from-fuchsia-500 dark:via-pink-600 dark:to-rose-600">
            <div className="text-4xl font-semibold leading-none tracking-tight opacity-90">
              {props.greeting}
            </div>
            <div className="mt-4 text-5xl font-extrabold leading-none tracking-tight">
              {props.name}
            </div>
          </div>
        )}
      </div>
    </McpUseProvider>
  );
};

export default GreetingCard;
