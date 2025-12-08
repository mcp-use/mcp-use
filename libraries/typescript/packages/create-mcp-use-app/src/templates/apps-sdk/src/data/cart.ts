import type { Cart, CartItem } from "../types/cart";
import { getProductById } from "./products";

// In-memory cart storage (in a real app, this would be in a database or session)
const carts = new Map<string, CartItem[]>();

// Default session ID for demo purposes
const DEFAULT_SESSION_ID = "demo-session";

// Helper to calculate cart totals
function calculateCart(items: CartItem[]): Cart {
  const subtotal = items.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    items,
    subtotal: Math.round(subtotal * 100) / 100, // Round to 2 decimal places
    itemCount,
  };
}

// Get cart for a session
export function getCart(sessionId: string = DEFAULT_SESSION_ID): Cart {
  const items = carts.get(sessionId) || [];
  return calculateCart(items);
}

// Add item to cart
export function addToCart(
  productId: string,
  quantity: number = 1,
  sessionId: string = DEFAULT_SESSION_ID
): Cart | null {
  const product = getProductById(productId);
  if (!product) {
    return null;
  }

  const items = carts.get(sessionId) || [];
  const existingItemIndex = items.findIndex(
    (item) => item.product.id === productId
  );

  if (existingItemIndex >= 0) {
    // Update quantity if item already exists
    items[existingItemIndex].quantity += quantity;
  } else {
    // Add new item
    items.push({ product, quantity });
  }

  carts.set(sessionId, items);
  return calculateCart(items);
}

// Update cart item quantity
export function updateCartItem(
  productId: string,
  quantity: number,
  sessionId: string = DEFAULT_SESSION_ID
): Cart | null {
  const items = carts.get(sessionId) || [];
  const itemIndex = items.findIndex((item) => item.product.id === productId);

  if (itemIndex === -1) {
    return null;
  }

  if (quantity <= 0) {
    // Remove item if quantity is 0 or less
    items.splice(itemIndex, 1);
  } else {
    items[itemIndex].quantity = quantity;
  }

  carts.set(sessionId, items);
  return calculateCart(items);
}

// Remove item from cart
export function removeFromCart(
  productId: string,
  sessionId: string = DEFAULT_SESSION_ID
): Cart {
  const items = carts.get(sessionId) || [];
  const filteredItems = items.filter((item) => item.product.id !== productId);

  carts.set(sessionId, filteredItems);
  return calculateCart(filteredItems);
}

// Clear cart
export function clearCart(sessionId: string = DEFAULT_SESSION_ID): Cart {
  carts.set(sessionId, []);
  return calculateCart([]);
}

// Check if cart is empty
export function isCartEmpty(sessionId: string = DEFAULT_SESSION_ID): boolean {
  const items = carts.get(sessionId) || [];
  return items.length === 0;
}
