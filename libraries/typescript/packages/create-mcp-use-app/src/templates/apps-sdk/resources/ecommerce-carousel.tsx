import React, { useState } from "react";
import { z } from "zod";
import { useWidget } from "mcp-use/react";
import {
  Button,
  Card,
  Carousel,
  CarouselItem,
  Transition,
  Icon,
} from "@openai/apps-sdk-ui";
import "../styles.css";

const propSchema = z.object({
  title: z.string().describe("The title of the ecommerce carousel"),
  description: z.string().describe("Description of the product collection"),
  items: z
    .array(
      z.object({
        id: z.string().describe("Product ID"),
        name: z.string().describe("Product name"),
        price: z.number().describe("Product price"),
        image: z.string().url().optional().describe("Product image URL"),
        description: z.string().optional().describe("Product description"),
      })
    )
    .describe("Array of products to display in the carousel"),
});

export const widgetMetadata = {
  description:
    "Display an ecommerce product carousel with title, description, and interactive product cards",
  inputs: propSchema,
};

type EcommerceCarouselProps = z.infer<typeof propSchema>;

const EcommerceCarousel: React.FC = () => {
  const { props, theme, callTool, setState, state } =
    useWidget<EcommerceCarouselProps>();
  const { title, description, items } = props;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cart, setCart] = useState<Array<{ id: string; name: string; price: number }>>(
    state?.cart || []
  );

  const handleAddToCart = async (item: {
    id: string;
    name: string;
    price: number;
  }) => {
    const newCart = [...cart, item];
    setCart(newCart);
    await setState({ cart: newCart });
    
    // Call tool to update cart
    try {
      await callTool("add-to-cart", {
        productId: item.id,
        productName: item.name,
        price: item.price,
      });
    } catch (error) {
      console.error("Failed to call add-to-cart tool:", error);
    }
  };

  const handleInfoClick = async (item: {
    id: string;
    name: string;
    description?: string;
  }) => {
    // Call tool to get product details
    try {
      await callTool("get-product-info", {
        productId: item.id,
        productName: item.name,
      });
    } catch (error) {
      console.error("Failed to call get-product-info tool:", error);
    }
  };

  const bgColor = theme === "dark" ? "bg-gray-900" : "bg-white";
  const textColor = theme === "dark" ? "text-gray-100" : "text-gray-900";
  const subtextColor = theme === "dark" ? "text-gray-400" : "text-gray-600";
  const cardBg = theme === "dark" ? "bg-gray-800" : "bg-gray-50";

  return (
    <div className={`${bgColor} rounded-lg p-6 max-w-4xl mx-auto`}>
      <div className="mb-6">
        <h1 className={`text-3xl font-bold ${textColor} mb-2`}>{title}</h1>
        <p className={`${subtextColor} text-lg`}>{description}</p>
      </div>

      <Carousel
        selectedIndex={selectedIndex}
        onSelectIndex={setSelectedIndex}
        className="w-full"
      >
        {items.map((item, index) => (
          <CarouselItem key={item.id} index={index}>
            <Transition
              in={selectedIndex === index}
              timeout={300}
              className="transition-all duration-300"
            >
              <Card className={`${cardBg} p-4 rounded-lg shadow-lg`}>
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-full h-48 bg-gray-300 rounded-lg flex items-center justify-center overflow-hidden">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-gray-500 text-center p-4">
                        <Icon name="image" size={48} />
                        <p className="mt-2">No image available</p>
                      </div>
                    )}
                  </div>

                  <div className="w-full text-center">
                    <h3 className={`text-xl font-semibold ${textColor} mb-2`}>
                      {item.name}
                    </h3>
                    {item.description && (
                      <p className={`${subtextColor} text-sm mb-3`}>
                        {item.description}
                      </p>
                    )}
                    <p className={`text-2xl font-bold ${textColor} mb-4`}>
                      ${item.price.toFixed(2)}
                    </p>
                  </div>

                  <div className="flex gap-3 w-full">
                    <Button
                      variant="outline"
                      onClick={() => handleInfoClick(item)}
                      className="flex-1"
                    >
                      <Icon name="info" size={16} className="mr-2" />
                      Info
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => handleAddToCart(item)}
                      className="flex-1"
                    >
                      <Icon name="shopping-cart" size={16} className="mr-2" />
                      Add to Cart
                    </Button>
                  </div>
                </div>
              </Card>
            </Transition>
          </CarouselItem>
        ))}
      </Carousel>

      <div className="mt-4 flex justify-center gap-2">
        {items.map((_, index) => (
          <button
            key={index}
            onClick={() => setSelectedIndex(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              selectedIndex === index
                ? "bg-blue-500 w-8"
                : theme === "dark"
                ? "bg-gray-600"
                : "bg-gray-300"
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>

      {cart.length > 0 && (
        <div className="mt-4 text-center">
          <p className={`${subtextColor} text-sm`}>
            {cart.length} item{cart.length !== 1 ? "s" : ""} in cart
          </p>
        </div>
      )}
    </div>
  );
};

export default EcommerceCarousel;
