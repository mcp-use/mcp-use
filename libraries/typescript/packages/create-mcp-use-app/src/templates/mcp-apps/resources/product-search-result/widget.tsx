import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import {
  Image,
  McpUseProvider,
  useCallTool,
  type WidgetMetadata,
} from "mcp-use/react";
import { Link } from "react-router";
import { z } from "zod";
import "../styles.css";
import { Carousel } from "./components/Carousel";

const propSchema = z.object({
  query: z.string(),
  results: z.array(z.object({ fruit: z.string(), color: z.string() })),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Display fruit search results",
  props: propSchema,
  exposeAsTool: false, // returned by the search-fruits tool
  metadata: {
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
};

// Props are auto-injected by the WidgetWrapper — isPending, tool input fields,
// and widget state (output, theme, callTool, etc.) are all flat props.
const ProductSearchResult = ({
  isPending,
  query,
  results,
}: {
  isPending: boolean;
  query?: string;
  results?: { fruit: string; color: string }[];
}) => {
  // Fully typed from .mcp-use/tool-registry.d.ts — no manual types needed
  const {
    callTool: getFruitDetails,
    data: fruitDetails,
    isPending: isLoadingDetails,
  } = useCallTool("get-fruit-details");

  const selectedFruit = fruitDetails?.structuredContent;

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className="relative bg-surface-elevated border border-default rounded-3xl p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100" />
          </div>
        </div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider debugger viewControls autoSize>
      <AppsSDKUIProvider linkComponent={Link}>
        <div className="relative bg-surface-elevated border border-default rounded-3xl">
          {/* Header */}
          <div className="p-8 pb-4">
            <h5 className="text-secondary mb-1">Fruit Shop</h5>
            <h2 className="heading-xl mb-1">Lovely Little Fruit Shop</h2>
            <p className="text-md text-secondary">
              {query
                ? `Showing results for "${query}"`
                : "Tap a fruit to see details"}
            </p>
          </div>

          {/* Carousel — results come from tool props */}
          <Carousel
            results={results ?? []}
            onSelectFruit={(fruit) => getFruitDetails({ fruit })}
          />

          {/* Detail view — image left, info right */}
          {selectedFruit && (
            <div className="mx-8 my-6 rounded-2xl border border-default bg-surface p-5 flex items-center gap-6">
              <div
                className={`rounded-xl p-4 flex-shrink-0 ${
                  (results ?? []).find((r) => r.fruit === selectedFruit.fruit)
                    ?.color ?? ""
                }`}
              >
                <Image
                  src={`/fruits/${selectedFruit.fruit}.png`}
                  alt={selectedFruit.fruit as string}
                  className="w-24 h-24 object-contain"
                />
              </div>
              <div className="flex-1">
                {isLoadingDetails ? (
                  <div className="animate-pulse h-4 w-32 bg-surface-elevated rounded" />
                ) : (
                  <>
                    <h3 className="font-semibold text-lg capitalize mb-2">
                      {selectedFruit.fruit as string}
                    </h3>
                    <ul className="space-y-1">
                      {(selectedFruit.facts as string[]).map((fact) => (
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
        </div>
      </AppsSDKUIProvider>
    </McpUseProvider>
  );
};

export default ProductSearchResult;
