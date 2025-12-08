import type { Order, PlaceOrderResult } from "../types/order";
import { getCart, clearCart } from "./cart";

// In-memory order storage (in a real app, this would be in a database)
const orders = new Map<string, Order>();
let orderCounter = 1000;

// Generate a random order ID
function generateOrderId(): string {
  orderCounter++;
  return `ORD-${orderCounter}`;
}

// Calculate estimated delivery date (3-5 business days from now)
function calculateEstimatedDelivery(): Date {
  const days = Math.floor(Math.random() * 3) + 3; // Random 3-5 days
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + days);
  return deliveryDate;
}

// Place an order
export function placeOrder(
  sessionId: string = "demo-session"
): PlaceOrderResult | null {
  const cart = getCart(sessionId);

  if (cart.items.length === 0) {
    return null;
  }

  const orderId = generateOrderId();
  const order: Order = {
    orderId,
    items: cart.items,
    total: cart.subtotal,
    status: "confirmed",
    createdAt: new Date(),
    estimatedDelivery: calculateEstimatedDelivery(),
  };

  orders.set(orderId, order);

  // Clear the cart after placing order
  clearCart(sessionId);

  return {
    order,
    message: `Order ${orderId} has been placed successfully! Your fruits will arrive in 3-5 business days.`,
  };
}

// Get order by ID
export function getOrderById(orderId: string): Order | null {
  return orders.get(orderId) || null;
}

// Get all orders (for demo purposes)
export function getAllOrders(): Order[] {
  return Array.from(orders.values());
}

// Update order status (mock implementation)
export function updateOrderStatus(
  orderId: string,
  status: Order["status"]
): Order | null {
  const order = orders.get(orderId);
  if (!order) {
    return null;
  }

  order.status = status;
  orders.set(orderId, order);
  return order;
}
