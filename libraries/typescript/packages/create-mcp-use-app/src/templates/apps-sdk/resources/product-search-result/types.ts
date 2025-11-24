import { z } from "zod";
import type { WidgetProps } from "mcp-use/react";

export const propSchema = z.object({
  query: z.string().describe("The search query"),
});

export type ProductSearchResultProps = WidgetProps<z.infer<typeof propSchema>>;

export type AccordionItemProps = {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
};
