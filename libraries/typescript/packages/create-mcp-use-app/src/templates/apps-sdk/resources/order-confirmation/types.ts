import { z } from "zod";

export const propSchema = z.object({
  orderId: z.string().describe("Unique order identifier"),
  items: z
    .array(
      z.object({
        productName: z.string(),
        quantity: z.number(),
        price: z.number(),
        image: z.string(),
      })
    )
    .describe("Items in the order"),
  total: z.number().describe("Total order amount"),
  status: z
    .enum(["pending", "confirmed", "shipped", "delivered"])
    .describe("Current order status"),
  estimatedDelivery: z
    .string()
    .describe("Estimated delivery date (ISO format)"),
  createdAt: z.string().describe("Order creation date (ISO format)"),
});

export type OrderConfirmationProps = z.infer<typeof propSchema>;
