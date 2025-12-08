import type { CartItem } from "./cart";

export interface Order {
  orderId: string;
  items: CartItem[];
  total: number;
  status: "pending" | "confirmed" | "shipped" | "delivered";
  createdAt: Date;
  estimatedDelivery: Date;
}

export interface PlaceOrderResult {
  order: Order;
  message: string;
}
