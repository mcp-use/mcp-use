import { z } from "zod";

export const propSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        productName: z.string(),
        quantity: z.number(),
        price: z.number(),
        image: z.string(),
        inStock: z.boolean(),
      })
    )
    .describe("Array of items in the cart"),
  subtotal: z.number().describe("Total price of all items"),
  itemCount: z.number().describe("Total number of items in cart"),
});

export type CartViewProps = z.infer<typeof propSchema>;
