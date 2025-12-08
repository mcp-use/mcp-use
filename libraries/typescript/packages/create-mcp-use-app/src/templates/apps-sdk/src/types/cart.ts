import type { Product } from "./product";

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  itemCount: number;
}

export interface AddToCartParams {
  productId: string;
  quantity: number;
}

export interface UpdateCartItemParams {
  productId: string;
  quantity: number;
}

export interface RemoveFromCartParams {
  productId: string;
}
