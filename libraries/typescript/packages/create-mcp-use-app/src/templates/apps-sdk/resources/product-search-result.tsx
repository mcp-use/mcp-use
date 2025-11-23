import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { Animate } from "@openai/apps-sdk-ui/components/Transition";
import { ErrorBoundary, Image, ThemeProvider, useWidget, WidgetDebugger } from "mcp-use/react";
import React, { StrictMode, useEffect, useRef } from "react";
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

const CarouselItem: React.FC<{ fruit: string; color: string }> = ({
  fruit,
  color,
}) => {
  return (
    <div
      className={`carousel-item size-52 rounded-xl border border-gray-200 dark:border-gray-800 ${color}`}
    >
      <div className="carousel-item-bg">
        <Image
          src={"/fruits/" + fruit + ".png"}
          alt={fruit}
        />
      </div>
      <div className="carousel-item-content">
        <Image 
          src={"/fruits/" + fruit + ".png"} 
          alt={fruit}
          className="w-24 h-24 object-contain"
        />
      </div>
    </div>
  );
};

const ProductSearchResult: React.FC = () => {
  const { props } = useWidget<ProductSearchResultProps>();
  const carouselContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
    { fruit: "mango", color: "bg-[#FBF1E1] dark:bg-[#FBF1E1]/10" },
    { fruit: "pineapple", color: "bg-[#f8f0d9] dark:bg-[#f8f0d9]/10" },
    { fruit: "cherries", color: "bg-[#E2EDDC] dark:bg-[#E2EDDC]/10" },
    { fruit: "coconut", color: "bg-[#fbedd3] dark:bg-[#fbedd3]/10" },
    { fruit: "apricot", color: "bg-[#fee6ca] dark:bg-[#fee6ca]/10" },
    { fruit: "blueberry", color: "bg-[#e0e6e6] dark:bg-[#e0e6e6]/10" },
    { fruit: "grapes", color: "bg-[#f4ebe2] dark:bg-[#f4ebe2]/10" },
    { fruit: "watermelon", color: "bg-[#e6eddb] dark:bg-[#e6eddb]/10" },
    { fruit: "orange", color: "bg-[#fdebdf] dark:bg-[#fdebdf]/10" },
    { fruit: "avocado", color: "bg-[#ecefda] dark:bg-[#ecefda]/10" },
    { fruit: "apple", color: "bg-[#F9E7E4] dark:bg-[#F9E7E4]/10" },
    { fruit: "pear", color: "bg-[#f1f1cf] dark:bg-[#f1f1cf]/10" },
    { fruit: "plum", color: "bg-[#ece5ec] dark:bg-[#ece5ec]/10" },
    { fruit: "banana", color: "bg-[#fdf0dd] dark:bg-[#fdf0dd]/10" },
    { fruit: "strawberry", color: "bg-[#f7e6df] dark:bg-[#f7e6df]/10" },
    { fruit: "lemon", color: "bg-[#feeecd] dark:bg-[#feeecd]/10" },
  ];

  // Global pointer tracking for all carousel items
  useEffect(() => {
    let lastPointerX = 0;
    let lastPointerY = 0;

    const updateItems = () => {
      const container = carouselContainerRef.current;
      if (!container) return;

      const articles = container.querySelectorAll<HTMLElement>(".carousel-item");
      
      articles.forEach((article) => {
        const rect = article.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const relativeX = lastPointerX - centerX;
        const relativeY = lastPointerY - centerY;
        const x = relativeX / (rect.width / 2);
        const y = relativeY / (rect.height / 2);

        // Calculate distance from cursor to center of item
        const distance = Math.sqrt(relativeX * relativeX + relativeY * relativeY);
        // Use a larger max distance to make the effect work across gaps
        const maxDistance = Math.max(rect.width, rect.height) * 2;
        const normalizedDistance = Math.min(distance / maxDistance, 1);
        
        // Closer items get higher opacity and scale
        // Use exponential falloff for smoother transition
        const proximity = Math.pow(1 - normalizedDistance, 2);
        const opacity = 0.1 + proximity * 0.3; // Range from 0.1 to 0.4
        const scale = 2.0 + proximity * 2.0; // Range from 2.0 to 4.0

        article.style.setProperty("--pointer-x", x.toFixed(3));
        article.style.setProperty("--pointer-y", y.toFixed(3));
        article.style.setProperty("--icon-opacity", opacity.toFixed(3));
        article.style.setProperty("--icon-scale", scale.toFixed(2));
      });
    };

    const handlePointerMove = (event: { clientX: number; clientY: number }) => {
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      updateItems();
    };

    const handleScroll = () => {
      updateItems();
    };
    
    document.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("scroll", handleScroll, true);
    
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll);
    }

    // Initial update
    updateItems();

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("scroll", handleScroll, true);
      const container = scrollContainerRef.current;
      if (container) {
        container.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  return (
    <StrictMode>
      <ThemeProvider>
        <WidgetDebugger>
        <BrowserRouter basename={getBasename()}>
          <AppsSDKUIProvider linkComponent={Link}>
            <ErrorBoundary>
              <div className="relative bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-3xl">
                <div className="p-8">
                  <h5 className="text-secondary mb-1">Apps SDK Template</h5>
                  <h2 className="heading-xl mb-3">Lovely Little Fruit Shop</h2>
                  <p className="text-md">
                    Start building your ChatGPT widget this this mcp-use template. It features the openai apps sdk ui components, dark/light theme support, actions like callTool and sendFollowUpMessage, and more.
                  </p>
                </div>
                <div 
                  ref={scrollContainerRef}
                  className="carousel-scroll-container w-full overflow-x-auto overflow-y-visible pl-8"
                >
                  <div ref={carouselContainerRef} className="overflow-visible">
                    <Animate className="flex gap-4">
                      {items.map((item) => (
                        <CarouselItem
                          key={item.fruit}
                          fruit={item.fruit}
                          color={item.color}
                        />
                      ))}
                    </Animate>
                  </div>
                </div>
              </div>
            </ErrorBoundary>
          </AppsSDKUIProvider>
        </BrowserRouter></WidgetDebugger>
      </ThemeProvider>
    </StrictMode>
  );
};

export default ProductSearchResult;
