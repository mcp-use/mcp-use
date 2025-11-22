import React, { useState, useEffect } from "react";
import { z } from "zod";
import { useWidget } from "mcp-use/react";
import {
  Button,
  Card,
  Input,
  Icon,
  Transition,
} from "@openai/apps-sdk-ui";
import "../styles.css";

const propSchema = z.object({
  query: z.string().describe("The search query"),
  results: z
    .array(
      z.object({
        id: z.string().describe("Product ID"),
        name: z.string().describe("Product name"),
        price: z.number().describe("Product price"),
        image: z.string().url().optional().describe("Product image URL"),
        rating: z.number().min(0).max(5).optional().describe("Product rating"),
        inStock: z.boolean().describe("Whether product is in stock"),
      })
    )
    .describe("Array of search results"),
});

export const widgetMetadata = {
  description:
    "Display product search results with filtering, state management, and tool interactions",
  inputs: propSchema,
};

type ProductSearchResultProps = z.infer<typeof propSchema>;

const ProductSearchResult: React.FC = () => {
  const { props, theme, callTool, sendFollowUpMessage, setState, state } =
    useWidget<ProductSearchResultProps>();
  const { query, results } = props;
  const [filteredResults, setFilteredResults] = useState(results);
  const [searchTerm, setSearchTerm] = useState(query);
  const [filters, setFilters] = useState<{
    minPrice?: number;
    maxPrice?: number;
    inStockOnly?: boolean;
  }>(state?.filters || {});

  useEffect(() => {
    let filtered = [...results];

    if (filters.minPrice !== undefined) {
      filtered = filtered.filter((r) => r.price >= filters.minPrice!);
    }
    if (filters.maxPrice !== undefined) {
      filtered = filtered.filter((r) => r.price <= filters.maxPrice!);
    }
    if (filters.inStockOnly) {
      filtered = filtered.filter((r) => r.inStock);
    }

    setFilteredResults(filtered);
  }, [results, filters]);

  const handleSearch = async (newQuery: string) => {
    setSearchTerm(newQuery);
    // Call tool to perform new search
    try {
      const result = await callTool("search-products", {
        query: newQuery,
      });
      // Send follow-up message to update the conversation
      await sendFollowUpMessage(
        `Searching for "${newQuery}" returned ${result.content?.length || 0} results`
      );
    } catch (error) {
      console.error("Failed to search products:", error);
    }
  };

  const handleFilterChange = async (newFilters: typeof filters) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    await setState({ filters: updatedFilters });
  };

  const handleProductClick = async (product: {
    id: string;
    name: string;
  }) => {
    // Call tool to get product details
    try {
      await callTool("get-product-details", {
        productId: product.id,
      });
      await sendFollowUpMessage(`Viewing details for ${product.name}`);
    } catch (error) {
      console.error("Failed to get product details:", error);
    }
  };

  const bgColor = theme === "dark" ? "bg-gray-900" : "bg-white";
  const textColor = theme === "dark" ? "text-gray-100" : "text-gray-900";
  const subtextColor = theme === "dark" ? "text-gray-400" : "text-gray-600";
  const cardBg = theme === "dark" ? "bg-gray-800" : "bg-gray-50";
  const borderColor =
    theme === "dark" ? "border-gray-700" : "border-gray-200";

  return (
    <div className={`${bgColor} rounded-lg p-6 max-w-6xl mx-auto`}>
      <div className="mb-6">
        <h1 className={`text-3xl font-bold ${textColor} mb-4`}>
          Product Search Results
        </h1>

        <div className="flex gap-3 mb-4">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search products..."
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                handleSearch(searchTerm);
              }
            }}
            className="flex-1"
          />
          <Button onClick={() => handleSearch(searchTerm)}>
            <Icon name="search" size={16} className="mr-2" />
            Search
          </Button>
        </div>

        <div className="flex gap-4 items-center flex-wrap">
          <label className={`${textColor} text-sm flex items-center gap-2`}>
            <input
              type="checkbox"
              checked={filters.inStockOnly || false}
              onChange={(e) =>
                handleFilterChange({ inStockOnly: e.target.checked })
              }
              className="mr-1"
            />
            In Stock Only
          </label>

          <div className="flex items-center gap-2">
            <label className={`${textColor} text-sm`}>Min Price:</label>
            <Input
              type="number"
              value={filters.minPrice || ""}
              onChange={(e) =>
                handleFilterChange({
                  minPrice: e.target.value
                    ? parseFloat(e.target.value)
                    : undefined,
                })
              }
              placeholder="0"
              className="w-24"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className={`${textColor} text-sm`}>Max Price:</label>
            <Input
              type="number"
              value={filters.maxPrice || ""}
              onChange={(e) =>
                handleFilterChange({
                  maxPrice: e.target.value
                    ? parseFloat(e.target.value)
                    : undefined,
                })
              }
              placeholder="1000"
              className="w-24"
            />
          </div>
        </div>
      </div>

      <div className="mb-4">
        <p className={subtextColor}>
          Found {filteredResults.length} result
          {filteredResults.length !== 1 ? "s" : ""} for "{query}"
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredResults.map((product, index) => (
          <Transition
            key={product.id}
            in={true}
            timeout={200}
            style={{ transitionDelay: `${index * 50}ms` }}
          >
            <Card
              className={`${cardBg} p-4 rounded-lg shadow-md border ${borderColor} cursor-pointer hover:shadow-lg transition-shadow`}
              onClick={() => handleProductClick(product)}
            >
              <div className="flex flex-col h-full">
                <div className="w-full h-40 bg-gray-300 rounded-lg flex items-center justify-center overflow-hidden mb-3">
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Icon name="image" size={32} />
                  )}
                </div>

                <h3 className={`text-lg font-semibold ${textColor} mb-2`}>
                  {product.name}
                </h3>

                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xl font-bold ${textColor}`}>
                    ${product.price.toFixed(2)}
                  </span>
                  {product.rating !== undefined && (
                    <div className="flex items-center">
                      <Icon name="star" size={16} className="text-yellow-400" />
                      <span className={`${subtextColor} text-sm ml-1`}>
                        {product.rating.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-auto pt-2">
                  {product.inStock ? (
                    <span className="text-green-500 text-sm font-medium">
                      ✓ In Stock
                    </span>
                  ) : (
                    <span className="text-red-500 text-sm font-medium">
                      ✗ Out of Stock
                    </span>
                  )}
                </div>
              </div>
            </Card>
          </Transition>
        ))}
      </div>

      {filteredResults.length === 0 && (
        <div className="text-center py-12">
          <Icon name="search" size={48} className={`${subtextColor} mb-4`} />
          <p className={subtextColor}>No products found matching your criteria</p>
        </div>
      )}
    </div>
  );
};

export default ProductSearchResult;
