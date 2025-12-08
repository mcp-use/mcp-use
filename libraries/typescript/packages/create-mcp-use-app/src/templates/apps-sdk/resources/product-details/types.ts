import { z } from "zod";

export const propSchema = z.object({
  id: z.string().describe("Product ID"),
  name: z.string().describe("Product name"),
  price: z.number().describe("Product price"),
  color: z.string().describe("Product color"),
  inStock: z.boolean().describe("Whether product is in stock"),
  stockCount: z.number().describe("Available stock quantity"),
  description: z.string().describe("Product description"),
  nutritionalInfo: z
    .object({
      calories: z.number(),
      vitaminC: z.string(),
      fiber: z.string(),
    })
    .describe("Nutritional information"),
  image: z.string().describe("Product image URL"),
});

export type ProductDetailsProps = z.infer<typeof propSchema>;
