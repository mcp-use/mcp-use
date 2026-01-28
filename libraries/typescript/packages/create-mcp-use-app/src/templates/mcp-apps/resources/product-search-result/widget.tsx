import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { QueryClientProvider } from "@tanstack/react-query";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { Link } from "react-router";
import "../styles.css";
import { Accordion } from "./components/Accordion";
import { Carousel } from "./components/Carousel";
import { queryClient } from "./constants";
import type { ProductSearchResultProps } from "./types";
import { propSchema } from "./types";

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display product search results with filtering, state management, and tool interactions",
  props: propSchema,
  metadata: {
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
};

const ProductSearchResult: React.FC = () => {
  const { props, mcp_url, isPending } = useWidget<ProductSearchResultProps>();

  console.log(props); // the widget props

  const accordionItems = [
    {
      question: "Demo of the autosize feature",
      answer:
        "This is a demo of the autosize feature. The widget will automatically resize to fit the content, as supported by the mcp-apps specification",
    },
  ];

  return (
    <McpUseProvider debugger viewControls autoSize>
      <AppsSDKUIProvider linkComponent={Link}>
        {isPending ? (
          <div className="relative bg-surface-elevated border border-default rounded-3xl p-8">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100"></div>
            </div>
          </div>
        ) : (
          <div className="relative bg-surface-elevated border border-default rounded-3xl">
            <div className="p-8">
              <h5 className="text-secondary mb-1">MCP-Apps Template</h5>
              <h2 className="heading-xl mb-3">Lovely Little Fruit Shop</h2>
              <p className="text-md">
                Start building your MCP-Apps widget with this mcp-use template.
                It features the mcp-apps ui components, dark/light theme
                support, actions like callTool and sendFollowUpMessage, and
                more.
              </p>
            </div>
            <Carousel mcpUrl={mcp_url} />
            <Accordion items={accordionItems} />
          </div>
        )}
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
