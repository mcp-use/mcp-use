import { z } from "zod";

export const propSchema = z.object({
  query: z.string().describe("The search query"),
  results: z.array(
    z.object({
      fruit: z.string(),
      color: z.string(),
    })
  ),
});

export type ProductSearchResultProps = z.infer<typeof propSchema>;
