import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";
import { Card } from "@/components/card";

const propSchema = z.object({
  greeting: z.string().describe("Greeting message from the server"),
  items: z
    .array(
      z.object({
        id: z.number(),
        label: z.string(),
      })
    )
    .describe("Items fetched via @/lib/server-data"),
});

export const widgetMetadata: WidgetMetadata = {
  description:
    "Renders items fetched from @/lib/server-data using a shared @/components/card component, proving Next.js tsconfig paths and server-only shims both work.",
  props: propSchema,
  exposeAsTool: false,
};

type ItemsProps = z.infer<typeof propSchema>;

const ItemsDisplay: React.FC = () => {
  const { props } = useWidget<ItemsProps>();
  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <Card title="Items (from @/lib/server-data)">
        <p>{props.greeting}</p>
        <ul>
          {(props.items ?? []).map((item) => (
            <li key={item.id}>
              {item.id}. {item.label}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

export default function ItemsWidget() {
  return (
    <McpUseProvider>
      <ItemsDisplay />
    </McpUseProvider>
  );
}
