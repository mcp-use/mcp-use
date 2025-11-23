import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { QueryClientProvider } from "@tanstack/react-query";
import { McpUseProvider, useWidget } from "mcp-use/react";
import React from "react";
import { Link } from "react-router";
import { Accordion } from "./components/Accordion";
import { Carousel } from "./components/Carousel";
import { queryClient } from "./constants";
import type { ProductSearchResultProps } from "./types";
import { propSchema } from "./types";
import "../../styles.css";

export const widgetMetadata = {
  description:
    "Display product search results with filtering, state management, and tool interactions",
  inputs: propSchema,
};

const ProductSearchResult: React.FC = () => {
  const { props, mcp_url } = useWidget<ProductSearchResultProps>();

  console.log(props);

  const accordionItems = [
    {
      question: "Demo of the autosize feature",
      answer:
        "This is a demo of the autosize feature. The widget will automatically resize to fit the content, as supported by the OpenAI apps sdk https://developers.openai.com/apps-sdk/build/mcp-server/",
    },
  ];

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

  return (
    <McpUseProvider debugger viewControls autoSize>
      <AppsSDKUIProvider linkComponent={Link}>
        <div className="relative bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-3xl">
          <div className="p-8">
            <h5 className="text-secondary mb-1">Apps SDK Template</h5>
            <h2 className="heading-xl mb-3">Lovely Little Fruit Shop</h2>
            <p className="text-md">
              Start building your ChatGPT widget this this mcp-use template. It
              features the openai apps sdk ui components, dark/light theme
              support, actions like callTool and sendFollowUpMessage, and more.
            </p>
          </div>
          <Carousel mcpUrl={mcp_url} />
          <Accordion items={accordionItems} />
        </div>
      </AppsSDKUIProvider>
    </McpUseProvider>
  );
};

const ProductSearchResultWithProvider: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ProductSearchResult />
    </QueryClientProvider>
  );
};

export default ProductSearchResultWithProvider;
