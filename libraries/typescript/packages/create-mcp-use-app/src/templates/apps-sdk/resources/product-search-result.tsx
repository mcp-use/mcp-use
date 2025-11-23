import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { Animate } from "@openai/apps-sdk-ui/components/Transition";
import { Image, useWidget } from "mcp-use/react";
import React, { StrictMode } from "react";
import { Link } from "react-router";
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

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Widget Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border border-red-500 bg-red-50 text-red-900 rounded-md">
          <h3 className="font-bold mb-2">Widget Error</h3>
          <pre className="text-sm whitespace-pre-wrap">
            {this.state.error?.message}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

const ProductSearchResult: React.FC = () => {
  const { props } = useWidget<ProductSearchResultProps>();

  console.log(props);

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
    { image_name: "apricot.jpg", top_right_color: "#fee6ca" },
    { image_name: "coconut.jpg", top_right_color: "#fbedd3" },
    { image_name: "pineapple.jpg", top_right_color: "#f8f0d9" },
    { image_name: "blueberry.jpg", top_right_color: "#e0e6e6" },
    { image_name: "mango.jpg", top_right_color: "#f9f0df" },
    { image_name: "grapse.jpg", top_right_color: "#f4ebe2" },
    { image_name: "watermelon.jpg", top_right_color: "#e6eddb" },
    { image_name: "cherries.jpg", top_right_color: "#e2ebda" },
    { image_name: "orange.jpg", top_right_color: "#fdebdf" },
    { image_name: "apple.jpg", top_right_color: "#ffffff" },
    { image_name: "avocado.jpg", top_right_color: "#ecefda" },
    { image_name: "pear.jpg", top_right_color: "#f1f1cf" },
    { image_name: "plum.jpg", top_right_color: "#ece5ec" },
    { image_name: "banana.jpg", top_right_color: "#fdf0dd" },
    { image_name: "lemon.jpg", top_right_color: "#feeecd" },
    { image_name: "strawberry.jpg", top_right_color: "#f7e6df" },
  ];

  return (
    <StrictMode>
      <AppsSDKUIProvider linkComponent={Link}>
        <ErrorBoundary>
          <div className="p-8 relative bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-xl">
            <h1 className="dark:text-white">Cute Fruits Store</h1>
            <p className="dark:text-gray-400">Find your favorite fruits</p>
            <div className="w-full overflow-x-auto">
              <Animate className="flex flex-wrap gap-4">
                {items.map((item) => (
                  <div key={item.image_name}>
                    <Image
                      src={"/fruits/" + item.image_name}
                      alt={item.image_name}
                    />
                  </div>
                ))}
              </Animate>
            </div>
          </div>
        </ErrorBoundary>
      </AppsSDKUIProvider>
    </StrictMode>
  );
};

export default ProductSearchResult;
