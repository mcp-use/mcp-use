import type { Product, ProductSearchFilters } from "../types/product";

export const products: Product[] = [
  {
    id: "mango",
    name: "Mango",
    price: 3.99,
    color: "orange",
    colorClass: "bg-[#FBF1E1] dark:bg-[#FBF1E1]/10",
    inStock: true,
    stockCount: 24,
    description:
      "Sweet and juicy tropical mango, perfect for smoothies or eating fresh. Rich in vitamins and antioxidants.",
    nutritionalInfo: {
      calories: 99,
      vitaminC: "67% DV",
      fiber: "3g",
    },
    image: "/fruits/mango.png",
  },
  {
    id: "pineapple",
    name: "Pineapple",
    price: 4.49,
    color: "yellow",
    colorClass: "bg-[#f8f0d9] dark:bg-[#f8f0d9]/10",
    inStock: true,
    stockCount: 18,
    description:
      "Fresh golden pineapple with sweet, tangy flavor. Great for tropical dishes and desserts.",
    nutritionalInfo: {
      calories: 82,
      vitaminC: "131% DV",
      fiber: "2.3g",
    },
    image: "/fruits/pineapple.png",
  },
  {
    id: "cherries",
    name: "Cherries",
    price: 6.99,
    color: "red",
    colorClass: "bg-[#E2EDDC] dark:bg-[#E2EDDC]/10",
    inStock: true,
    stockCount: 32,
    description:
      "Sweet, plump cherries bursting with flavor. Perfect for snacking or baking.",
    nutritionalInfo: {
      calories: 87,
      vitaminC: "16% DV",
      fiber: "3g",
    },
    image: "/fruits/cherries.png",
  },
  {
    id: "coconut",
    name: "Coconut",
    price: 5.99,
    color: "brown",
    colorClass: "bg-[#fbedd3] dark:bg-[#fbedd3]/10",
    inStock: true,
    stockCount: 15,
    description:
      "Fresh coconut with sweet water and creamy flesh. Great for cooking and baking.",
    nutritionalInfo: {
      calories: 354,
      vitaminC: "4% DV",
      fiber: "9g",
    },
    image: "/fruits/coconut.png",
  },
  {
    id: "apricot",
    name: "Apricot",
    price: 4.29,
    color: "orange",
    colorClass: "bg-[#fee6ca] dark:bg-[#fee6ca]/10",
    inStock: false,
    stockCount: 0,
    description:
      "Velvety apricots with a sweet-tart taste. Excellent fresh or dried.",
    nutritionalInfo: {
      calories: 48,
      vitaminC: "17% DV",
      fiber: "2g",
    },
    image: "/fruits/apricot.png",
  },
  {
    id: "blueberry",
    name: "Blueberry",
    price: 7.99,
    color: "blue",
    colorClass: "bg-[#e0e6e6] dark:bg-[#e0e6e6]/10",
    inStock: true,
    stockCount: 45,
    description:
      "Antioxidant-rich blueberries, sweet and bursting with nutrients. Perfect for breakfast.",
    nutritionalInfo: {
      calories: 84,
      vitaminC: "24% DV",
      fiber: "3.6g",
    },
    image: "/fruits/blueberry.png",
  },
  {
    id: "grapes",
    name: "Grapes",
    price: 5.49,
    color: "purple",
    colorClass: "bg-[#f4ebe2] dark:bg-[#f4ebe2]/10",
    inStock: true,
    stockCount: 28,
    description:
      "Sweet, seedless grapes perfect for snacking. Rich in vitamins and minerals.",
    nutritionalInfo: {
      calories: 104,
      vitaminC: "27% DV",
      fiber: "1.4g",
    },
    image: "/fruits/grapes.png",
  },
  {
    id: "watermelon",
    name: "Watermelon",
    price: 8.99,
    color: "red",
    colorClass: "bg-[#e6eddb] dark:bg-[#e6eddb]/10",
    inStock: true,
    stockCount: 12,
    description:
      "Refreshing and hydrating watermelon, perfect for summer. Sweet and juicy.",
    nutritionalInfo: {
      calories: 46,
      vitaminC: "21% DV",
      fiber: "0.6g",
    },
    image: "/fruits/watermelon.png",
  },
  {
    id: "orange",
    name: "Orange",
    price: 2.99,
    color: "orange",
    colorClass: "bg-[#fdebdf] dark:bg-[#fdebdf]/10",
    inStock: true,
    stockCount: 56,
    description:
      "Juicy citrus oranges packed with vitamin C. Great for fresh juice or snacking.",
    nutritionalInfo: {
      calories: 62,
      vitaminC: "93% DV",
      fiber: "3.1g",
    },
    image: "/fruits/orange.png",
  },
  {
    id: "avocado",
    name: "Avocado",
    price: 3.49,
    color: "green",
    colorClass: "bg-[#ecefda] dark:bg-[#ecefda]/10",
    inStock: true,
    stockCount: 34,
    description:
      "Creamy avocado perfect for toast, salads, or guacamole. Heart-healthy fats.",
    nutritionalInfo: {
      calories: 234,
      vitaminC: "17% DV",
      fiber: "10g",
    },
    image: "/fruits/avocado.png",
  },
  {
    id: "apple",
    name: "Apple",
    price: 1.99,
    color: "red",
    colorClass: "bg-[#F9E7E4] dark:bg-[#F9E7E4]/10",
    inStock: true,
    stockCount: 67,
    description:
      "Crisp and sweet apples, a classic favorite. Perfect for snacking or baking.",
    nutritionalInfo: {
      calories: 95,
      vitaminC: "14% DV",
      fiber: "4.4g",
    },
    image: "/fruits/apple.png",
  },
  {
    id: "pear",
    name: "Pear",
    price: 2.49,
    color: "green",
    colorClass: "bg-[#f1f1cf] dark:bg-[#f1f1cf]/10",
    inStock: true,
    stockCount: 41,
    description:
      "Sweet and juicy pears with a smooth texture. Great for fresh eating.",
    nutritionalInfo: {
      calories: 101,
      vitaminC: "12% DV",
      fiber: "5.5g",
    },
    image: "/fruits/pear.png",
  },
  {
    id: "plum",
    name: "Plum",
    price: 3.79,
    color: "purple",
    colorClass: "bg-[#ece5ec] dark:bg-[#ece5ec]/10",
    inStock: false,
    stockCount: 0,
    description:
      "Juicy plums with a perfect balance of sweet and tart. Delicious fresh or cooked.",
    nutritionalInfo: {
      calories: 46,
      vitaminC: "16% DV",
      fiber: "1.4g",
    },
    image: "/fruits/plum.png",
  },
  {
    id: "banana",
    name: "Banana",
    price: 1.49,
    color: "yellow",
    colorClass: "bg-[#fdf0dd] dark:bg-[#fdf0dd]/10",
    inStock: true,
    stockCount: 89,
    description:
      "Classic yellow bananas, naturally sweet and convenient. Great source of potassium.",
    nutritionalInfo: {
      calories: 105,
      vitaminC: "17% DV",
      fiber: "3.1g",
    },
    image: "/fruits/banana.png",
  },
  {
    id: "strawberry",
    name: "Strawberry",
    price: 5.99,
    color: "red",
    colorClass: "bg-[#f7e6df] dark:bg-[#f7e6df]/10",
    inStock: true,
    stockCount: 52,
    description:
      "Fresh, sweet strawberries bursting with flavor. Perfect for desserts and smoothies.",
    nutritionalInfo: {
      calories: 49,
      vitaminC: "149% DV",
      fiber: "3g",
    },
    image: "/fruits/strawberry.png",
  },
  {
    id: "lemon",
    name: "Lemon",
    price: 0.99,
    color: "yellow",
    colorClass: "bg-[#feeecd] dark:bg-[#feeecd]/10",
    inStock: true,
    stockCount: 73,
    description:
      "Tangy lemons perfect for cooking, baking, and beverages. High in vitamin C.",
    nutritionalInfo: {
      calories: 29,
      vitaminC: "88% DV",
      fiber: "2.8g",
    },
    image: "/fruits/lemon.png",
  },
];

// Helper function to get product by ID
export function getProductById(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

// Helper function to search products with filters
export function searchProducts(filters: ProductSearchFilters = {}): Product[] {
  let results = [...products];

  if (filters.color) {
    results = results.filter(
      (p) => p.color.toLowerCase() === filters.color!.toLowerCase()
    );
  }

  if (filters.minPrice !== undefined) {
    results = results.filter((p) => p.price >= filters.minPrice!);
  }

  if (filters.maxPrice !== undefined) {
    results = results.filter((p) => p.price <= filters.maxPrice!);
  }

  if (filters.inStockOnly) {
    results = results.filter((p) => p.inStock);
  }

  if (filters.query) {
    const query = filters.query.toLowerCase();
    results = results.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
    );
  }

  return results;
}

// Helper function to get inventory status
export function getInventoryStatus(productId: string): {
  productId: string;
  inStock: boolean;
  stockCount: number;
} | null {
  const product = getProductById(productId);
  if (!product) return null;

  return {
    productId: product.id,
    inStock: product.inStock,
    stockCount: product.stockCount,
  };
}
