import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { Animate } from "@openai/apps-sdk-ui/components/Transition";
import { ErrorBoundary, Image, ThemeProvider, useWidget } from "mcp-use/react";
import React, { StrictMode } from "react";
import { BrowserRouter, Link } from "react-router";
import { z } from "zod";
import "../styles.css";

const propSchema = z.object({
  query: z.string().describe("The search query"),
});

export const widgetMetadata = {
  description:
    "Display product search results with filtering, state management, and tool interactions",
  inputs: propSchema,
};

type ProductSearchResultProps = z.infer<typeof propSchema>;

const ProductSearchResult: React.FC = () => {
  const { props } = useWidget<ProductSearchResultProps>();

  console.log(props);

  // Calculate basename for proper routing in both dev proxy and production
  const getBasename = () => {
    if (typeof window === "undefined") return "/";
    const path = window.location.pathname;
    // Check for inspector dev widget proxy pattern
    const match = path.match(/^(\/inspector\/api\/dev-widget\/[^/]+)/);
    if (match) {
      return match[1];
    }
    return "/";
  };

  // const handleProductClick = async (product: { id: string; name: string }) => {
  //   // Call tool to get product details
  //   try {
  //     await callTool("get-product-details", {
  //       productId: product.id,
  //     });
  //     await sendFollowUpMessage(`Viewing details for ${product.name}`);
  //   } catch (error) {
  //     console.error("Failed to get product details:", error);
  //   }
  // };

  const items = [
    { fruit: "mango", color: "bg-[#f9f0df] dark:bg-[#f9f0df]/20" },
    { fruit: "apple", color: "bg-[#ffffff] dark:bg-[#ffffff]/50" },
    { fruit: "apricot", color: "bg-[#fee6ca] dark:bg-[#fee6ca]/50" },
    { fruit: "coconut", color: "bg-[#fbedd3] dark:bg-[#fbedd3]/50" },
    { fruit: "pineapple", color: "bg-[#f8f0d9] dark:bg-[#f8f0d9]/50" },
    { fruit: "blueberry", color: "bg-[#e0e6e6] dark:bg-[#e0e6e6]/50" },
    { fruit: "grapes", color: "bg-[#f4ebe2] dark:bg-[#f4ebe2]/50" },
    { fruit: "watermelon", color: "bg-[#e6eddb] dark:bg-[#e6eddb]/50" },
    { fruit: "cherries", color: "bg-[#e2ebda] dark:bg-[#e2ebda]/50" },
    { fruit: "orange", color: "bg-[#fdebdf] dark:bg-[#fdebdf]/50" },
    { fruit: "avocado", color: "bg-[#ecefda] dark:bg-[#ecefda]/50" },
    { fruit: "pear", color: "bg-[#f1f1cf] dark:bg-[#f1f1cf]/50" },
    { fruit: "plum", color: "bg-[#ece5ec] dark:bg-[#ece5ec]/50" },
    { fruit: "banana", color: "bg-[#fdf0dd] dark:bg-[#fdf0dd]/50" },
    { fruit: "lemon", color: "bg-[#feeecd] dark:bg-[#feeecd]/50" },
    { fruit: "strawberry", color: "bg-[#f7e6df] dark:bg-[#f7e6df]/50" },
  ];

  return (
    <StrictMode>
      <ThemeProvider>
        <BrowserRouter basename={getBasename()}>
          <AppsSDKUIProvider linkComponent={Link}>
            <ErrorBoundary>
              <div className="relative bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-xl">
                <div className="p-8">
                  <h5 className="text-secondary mb-1">Get started</h5>
                  <h2 className="heading-xl mb-3">Building your first app</h2>
                  <p className="text-md">
                    Inline cards in Apps SDK UI keep copy short and actionable.
                    Provide just enough context for the task, then pair it with
                    a clear next step.
                  </p>
                </div>
                <div className="w-full overflow-x-auto p-8">
                  <Animate className="flex gap-4">
                    {items.map((item) => (
                      <div
                        key={item.fruit}
                        className={`size-52 p-16 rounded-xl flex items-center justify-center border border-gray-200 dark:border-gray-800 ${item.color}`}
                      >
                        <Image
                          src={"/fruits/" + item.fruit + ".png"}
                          alt={item.fruit}
                        />
                      </div>
                    ))}
                  </Animate>
                </div>
              </div>
            </ErrorBoundary>
          </AppsSDKUIProvider>
        </BrowserRouter>
      </ThemeProvider>
    </StrictMode>
  );
};

export default ProductSearchResult;
