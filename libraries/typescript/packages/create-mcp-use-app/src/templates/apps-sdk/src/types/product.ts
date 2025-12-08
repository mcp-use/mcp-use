export interface Product {
  id: string;
  name: string;
  price: number;
  color: string;
  colorClass: string; // Tailwind color class for UI
  inStock: boolean;
  stockCount: number;
  description: string;
  nutritionalInfo: {
    calories: number;
    vitaminC: string;
    fiber: string;
  };
  image: string; // path to image
}

export interface ProductSearchFilters {
  color?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  query?: string;
}
