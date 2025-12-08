import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Icon } from "@openai/apps-sdk-ui/components/Icon";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React, { useState } from "react";
import { Link } from "react-router";
import { propSchema, type ProductDetailsProps } from "./types";
import "../styles.css";

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display detailed information about a specific fruit including large image, description, nutritional facts, price, and stock status. Allows adding to cart directly from the detail view.",
  inputs: propSchema,
};

const ProductDetails: React.FC = () => {
  const { props, callTool, sendFollowUpMessage } =
    useWidget<ProductDetailsProps>();
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddToCart = async () => {
    setIsAdding(true);
    try {
      await callTool("add-to-cart", {
        productId: props.id,
        quantity,
      });
      await sendFollowUpMessage(
        `Added ${quantity}x ${props.name} to your cart! Want to view your cart or continue shopping?`
      );
    } catch (error) {
      console.error("Failed to add to cart:", error);
    } finally {
      setIsAdding(false);
    }
  };

  const incrementQuantity = () => {
    if (quantity < props.stockCount) {
      setQuantity(quantity + 1);
    }
  };

  const decrementQuantity = () => {
    if (quantity > 1) {
      setQuantity(quantity - 1);
    }
  };

  return (
    <McpUseProvider debugger viewControls>
      <AppsSDKUIProvider linkComponent={Link}>
        <div className="bg-surface-elevated border border-default rounded-3xl p-8">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Product Image */}
            <div className="flex items-center justify-center">
              <div className="relative">
                <img
                  src={props.image}
                  alt={props.name}
                  className="w-full max-w-md rounded-3xl shadow-lg"
                />
                {!props.inStock && (
                  <div className="absolute inset-0 bg-black/50 rounded-3xl flex items-center justify-center">
                    <span className="bg-danger text-white px-6 py-3 rounded-full font-semibold">
                      Out of Stock
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Product Info */}
            <div className="flex flex-col">
              <div className="flex-1">
                <div className="mb-4">
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="heading-2xl">{props.name}</h1>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        props.inStock
                          ? "bg-success/10 text-success"
                          : "bg-danger/10 text-danger"
                      }`}
                    >
                      {props.inStock
                        ? `${props.stockCount} in stock`
                        : "Out of stock"}
                    </span>
                  </div>
                  <p className="heading-xl text-success">
                    ${props.price.toFixed(2)}
                  </p>
                </div>

                <p className="text-secondary mb-6 text-lg leading-relaxed">
                  {props.description}
                </p>

                {/* Nutritional Info */}
                <div className="bg-surface rounded-2xl p-6 mb-6">
                  <h3 className="heading-md mb-4 flex items-center gap-2">
                    <Icon name="heart" className="text-danger" />
                    Nutritional Information
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-primary">
                        {props.nutritionalInfo.calories}
                      </p>
                      <p className="text-sm text-secondary">Calories</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-primary">
                        {props.nutritionalInfo.vitaminC}
                      </p>
                      <p className="text-sm text-secondary">Vitamin C</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-primary">
                        {props.nutritionalInfo.fiber}
                      </p>
                      <p className="text-sm text-secondary">Fiber</p>
                    </div>
                  </div>
                </div>

                {/* Product Highlights */}
                <div className="bg-info/10 rounded-2xl p-6 mb-6">
                  <h3 className="heading-sm mb-3">Why you'll love it</h3>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <Icon name="check" className="text-success" />
                      <span>Fresh and hand-picked</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Icon name="check" className="text-success" />
                      <span>Sustainably sourced</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Icon name="check" className="text-success" />
                      <span>Delivered within 3-5 days</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Add to Cart Section */}
              <div className="border-t border-default pt-6">
                <div className="flex items-center gap-4 mb-4">
                  <span className="text-secondary">Quantity:</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="small"
                      onClick={decrementQuantity}
                      disabled={quantity <= 1 || !props.inStock}
                    >
                      <Icon name="minus" />
                    </Button>
                    <span className="w-12 text-center font-semibold text-lg">
                      {quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="small"
                      onClick={incrementQuantity}
                      disabled={quantity >= props.stockCount || !props.inStock}
                    >
                      <Icon name="plus" />
                    </Button>
                  </div>
                  <span className="text-secondary ml-auto">
                    Total:{" "}
                    <span className="heading-md text-primary">
                      ${(props.price * quantity).toFixed(2)}
                    </span>
                  </span>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    onClick={handleAddToCart}
                    disabled={!props.inStock || isAdding}
                    className="flex-1"
                  >
                    {isAdding ? (
                      "Adding..."
                    ) : (
                      <>
                        <Icon name="shopping-cart" />
                        Add to Cart
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      sendFollowUpMessage(`Show me other ${props.color} fruits`)
                    }
                  >
                    <Icon name="search" />
                    Similar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppsSDKUIProvider>
    </McpUseProvider>
  );
};

export default ProductDetails;
