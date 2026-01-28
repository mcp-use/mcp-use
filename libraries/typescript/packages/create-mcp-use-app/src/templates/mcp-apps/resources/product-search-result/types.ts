import { z } from "zod";

export const propSchema = z.object({
  query: z.string().describe("The search query"),
});

export type ProductSearchResultProps = z.infer<typeof propSchema>;

export type AccordionItemProps = {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
};
