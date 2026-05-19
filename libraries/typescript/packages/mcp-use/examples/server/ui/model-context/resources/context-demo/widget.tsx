import {
  McpUseProvider,
  ModelContext,
  modelContext,
  useWidget,
  type WidgetMetadata,
} from "mcp-use/react";
import React, { useState } from "react";
import { z } from "zod";

const propSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price: z.number(),
      category: z.string(),
    })
  ),
  initialCategory: z.string().nullable(),
});

export const widgetMetadata: WidgetMetadata = {
  description:
    "Interactive product browser demonstrating ModelContext for AI-aware UI state",
  props: propSchema,
  metadata: {
    prefersBorder: true,
    autoResize: true,
  },
};

type Product = { id: string; name: string; price: number; category: string };
type Props = z.infer<typeof propSchema>;

const ContextDemo: React.FC = () => {
  const { props, isPending, theme } = useWidget<Props>();
  const isDark = theme === "dark";

  const products: Product[] = props.products ?? [];
  const categories = Array.from(new Set(products.map((p) => p.category)));

  const [activeTab, setActiveTab] = useState<string>(
    () => (props.initialCategory as string) ?? categories[0] ?? ""
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const filteredProducts = products.filter((p) => p.category === activeTab);
  const hoveredProduct = products.find((p) => p.id === hoveredId) ?? null;

  function handleSelect(product: Product) {
    setSelectedProduct(product);
    // Imperative API — works outside JSX, persists even after product unmounts
    modelContext.set(
      "selected-product",
      `User selected: ${product.name} ($${product.price}) in ${product.category}`
    );
  }

  function handleDeselect() {
    setSelectedProduct(null);
    modelContext.remove("selected-product");
  }

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className={`p-8 ${isDark ? "text-white" : "text-gray-900"}`}>
          <div className="animate-pulse flex flex-col gap-4">
            <div
              className={`h-8 w-40 rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            />
            <div
              className={`h-4 w-full rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            />
            <div
              className={`h-4 w-3/4 rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            />
          </div>
        </div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      {/*
        Root-level context: always visible to the model while the widget is mounted.
        Acts as a parent scope — all nested ModelContext nodes become children in
        the serialized tree.
      */}
      <ModelContext content="User is browsing the product catalog widget">
        {/* Active tab annotation — re-registers when activeTab changes */}
        <ModelContext
          content={`Active category tab: ${activeTab} (${filteredProducts.length} products)`}
        />

        {/* Hover annotation — only present when a product is being hovered */}
        {hoveredProduct && (
          <ModelContext
            content={`User is hovering over: ${hoveredProduct.name} ($${hoveredProduct.price})`}
          />
        )}

        <div
          className={`rounded-2xl overflow-hidden ${
            isDark ? "bg-gray-900 text-white" : "bg-white text-gray-900"
          }`}
        >
          {/* Header */}
          <div
            className={`px-6 py-4 border-b ${
              isDark ? "border-gray-700" : "border-gray-200"
            }`}
          >
            <h2 className="text-lg font-semibold">Product Catalog</h2>
            <p
              className={`text-sm mt-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              Hover or click a product — the AI model tracks what you're viewing
            </p>
          </div>

          {/* Category tabs */}
          <div
            className={`flex gap-1 px-4 pt-3 border-b ${
              isDark ? "border-gray-700" : "border-gray-100"
            }`}
          >
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveTab(cat)}
                className={`px-3 py-1.5 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === cat
                    ? isDark
                      ? "bg-blue-600 text-white"
                      : "bg-blue-600 text-white"
                    : isDark
                      ? "text-gray-400 hover:text-white hover:bg-gray-700"
                      : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <div className="grid grid-cols-2 gap-3 p-4">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() =>
                  selectedProduct?.id === product.id
                    ? handleDeselect()
                    : handleSelect(product)
                }
                onMouseEnter={() => setHoveredId(product.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`text-left p-3 rounded-xl border transition-all ${
                  selectedProduct?.id === product.id
                    ? isDark
                      ? "border-blue-500 bg-blue-900/30"
                      : "border-blue-500 bg-blue-50"
                    : hoveredId === product.id
                      ? isDark
                        ? "border-gray-500 bg-gray-700"
                        : "border-gray-300 bg-gray-50"
                      : isDark
                        ? "border-gray-700 bg-gray-800"
                        : "border-gray-200 bg-white"
                }`}
              >
                <div className="font-medium text-sm">{product.name}</div>
                <div
                  className={`text-sm mt-1 ${
                    isDark ? "text-gray-400" : "text-gray-500"
                  }`}
                >
                  ${product.price}
                </div>
                {selectedProduct?.id === product.id && (
                  <div className="text-xs text-blue-500 mt-1 font-medium">
                    ✓ Selected
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Context debug panel */}
          <div
            className={`mx-4 mb-4 p-3 rounded-xl text-xs ${
              isDark ? "bg-gray-800 text-gray-400" : "bg-gray-50 text-gray-500"
            }`}
          >
            <div className="font-medium mb-1.5">Model context sent to AI:</div>
            <div className="font-mono whitespace-pre leading-relaxed">
              {[
                `- User is browsing the product catalog widget`,
                `  - Active category tab: ${activeTab} (${filteredProducts.length} products)`,
                hoveredProduct
                  ? `  - User is hovering over: ${hoveredProduct.name} ($${hoveredProduct.price})`
                  : null,
                selectedProduct
                  ? `- User selected: ${selectedProduct.name} ($${selectedProduct.price}) in ${selectedProduct.category}`
                  : null,
              ]
                .filter(Boolean)
                .join("\n")}
            </div>
          </div>
        </div>
      </ModelContext>
    </McpUseProvider>
  );
};

export default ContextDemo;
