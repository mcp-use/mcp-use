import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import {
  Image,
  McpUseProvider,
  useCallTool,
  useWidget,
  type WidgetMetadata,
} from "mcp-use/react";
import React from "react";
import { Link } from "react-router";
import "../styles.css";
import { Carousel } from "./components/Carousel";
import { CarouselSkeleton } from "./components/CarouselSkeleton";
import { Accordion } from "./components/Accordion";
import type { ProductSearchResultProps } from "./types";
import { propSchema } from "./types";

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display product search results with filtering, state management, and tool interactions",
  props: propSchema,
  exposeAsTool: false, // returned by the search-tools tool
  metadata: {
    prefersBorder: false,
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
};

const ProductSearchResult: React.FC = () => {
  const { props, isPending } = useWidget<ProductSearchResultProps>();

  const {
    callTool: getFruitDetails,
    data: fruitDetails,
    isPending: isLoadingDetails,
  } = useCallTool("get-fruit-details");

  const selectedFruit = fruitDetails?.structuredContent;

  const accordionItems = [
    {
      question: "Demo of the autosize feature",
      answer:
        "This is a demo of the autosize feature. The widget will automatically resize to fit the content, as supported by the mcp-apps specification",
    },
  ];

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className="relative bg-surface-elevated border border-default rounded-3xl">
          <div className="p-8 pb-4">
            <h5 className="text-secondary mb-1">MCP-Apps Template</h5>
            <h2 className="heading-xl mb-3">Lovely Little Fruit Shop</h2>
            <div className="h-5 w-48 rounded-md bg-default/10 animate-pulse" />
          </div>
          <CarouselSkeleton />
        </div>
      </McpUseProvider>
    );
  }

  const { query, results } = props;

  return (
    <McpUseProvider debugger viewControls autoSize>
      <AppsSDKUIProvider linkComponent={Link}>
        <div className="relative bg-surface-elevated border border-default rounded-3xl">
          {/* Header */}
          <div className="p-8 pb-4">
            <h5 className="text-secondary mb-1">MCP-Apps Template</h5>
            <h2 className="heading-xl mb-1">Lovely Little Fruit Shop</h2>
            <p className="text-md text-secondary">
              {query
                ? `Showing results for "${query}"`
                : "Tap a fruit to see details"}
            </p>
          </div>

          {/* Carousel — results come from tool props */}
          <Carousel
            results={results}
            onSelectFruit={(fruit) => getFruitDetails({ fruit })}
          />

          {/* Detail view — image left, info right */}
          {selectedFruit && (
            <div className="mx-8 my-6 rounded-2xl border border-default bg-surface p-5 flex items-center gap-6">
              <div
                className={`rounded-xl p-4 flex-shrink-0 ${
                  results.find((r) => r.fruit === selectedFruit.fruit)?.color ??
                  ""
                }`}
              >
                <Image
                  src={`/fruits/${selectedFruit.fruit}.png`}
                  alt={selectedFruit.fruit}
                  className="w-24 h-24 object-contain"
                />
              </div>
              <div className="flex-1">
                {isLoadingDetails ? (
                  <div className="animate-pulse h-4 w-32 bg-surface-elevated rounded" />
                ) : (
                  <>
                    <h3 className="font-semibold text-lg capitalize mb-2">
                      {selectedFruit.fruit}
                    </h3>
                    <ul className="space-y-1">
                      {(selectedFruit.facts ?? []).map((fact) => (
                        <li
                          key={fact}
                          className="text-sm text-secondary flex items-start gap-2"
                        >
                          <span className="text-info mt-0.5">•</span>
                          {fact}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          <Accordion items={accordionItems} />
        </div>
      </AppsSDKUIProvider>
    </McpUseProvider>
  );
};

export default ProductSearchResult;
