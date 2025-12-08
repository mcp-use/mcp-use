import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ShoppingBag,
  Minus,
  Plus,
  Trash,
} from "@openai/apps-sdk-ui/components/Icon";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React, { useState } from "react";
import { Link } from "react-router";
import { propSchema, type CartViewProps } from "./types";
import "../styles.css";

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display the user's shopping cart with all items, quantities, prices, and total. Allows users to update quantities, remove items, and proceed to checkout.",
  inputs: propSchema,
};

const CartView: React.FC = () => {
  const { props, callTool, sendFollowUpMessage } = useWidget<CartViewProps>();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUpdateQuantity = async (
    productId: string,
    newQuantity: number
  ) => {
    setIsProcessing(true);
    try {
      await callTool("update-cart-item", {
        productId,
        quantity: newQuantity,
      });
      await sendFollowUpMessage(
        `Updated quantity for ${props.items.find((i) => i.productId === productId)?.productName}`
      );
    } catch (error) {
      console.error("Failed to update quantity:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveItem = async (productId: string, productName: string) => {
    setIsProcessing(true);
    try {
      await callTool("remove-from-cart", { productId });
      await sendFollowUpMessage(`Removed ${productName} from cart`);
    } catch (error) {
      console.error("Failed to remove item:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCheckout = async () => {
    setIsProcessing(true);
    try {
      await callTool("place-order", {});
      await sendFollowUpMessage(
        "Order placed successfully! Check your order confirmation above."
      );
    } catch (error) {
      console.error("Failed to place order:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearCart = async () => {
    setIsProcessing(true);
    try {
      await callTool("clear-cart", {});
      await sendFollowUpMessage("Cart has been cleared");
    } catch (error) {
      console.error("Failed to clear cart:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Empty cart state
  if (props.items.length === 0) {
    return (
      <McpUseProvider debugger viewControls>
        <AppsSDKUIProvider linkComponent={Link}>
          <div className="bg-surface-elevated border border-default rounded-3xl p-8">
            <div className="text-center py-12">
              <ShoppingBag className="w-16 h-16 mx-auto mb-4 text-secondary" />
              <h2 className="heading-xl mb-2">Your cart is empty</h2>
              <p className="text-md text-secondary mb-6">
                Start adding some delicious fruits to your cart!
              </p>
              <Button
                variant="solid"
                color="primary"
                onClick={() =>
                  sendFollowUpMessage("Show me some fruits to buy")
                }
              >
                Browse Fruits
              </Button>
            </div>
          </div>
        </AppsSDKUIProvider>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider debugger viewControls>
      <AppsSDKUIProvider linkComponent={Link}>
        <div className="bg-surface-elevated border border-default rounded-3xl p-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="heading-xl">Shopping Cart</h2>
            <Button
              variant="ghost"
              color="secondary"
              size="sm"
              onClick={handleClearCart}
              disabled={isProcessing}
            >
              Clear Cart
            </Button>
          </div>

          <div className="space-y-4 mb-6">
            {props.items.map((item) => (
              <div
                key={item.productId}
                className="flex items-center gap-4 p-4 bg-surface rounded-2xl border border-default"
              >
                <img
                  src={item.image}
                  alt={item.productName}
                  className="w-16 h-16 object-cover rounded-xl"
                />

                <div className="flex-1">
                  <h3 className="font-semibold text-primary">
                    {item.productName}
                  </h3>
                  <p className="text-sm text-secondary">
                    ${item.price.toFixed(2)} each
                  </p>
                  {!item.inStock && (
                    <p className="text-sm text-danger mt-1">Out of stock</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    color="secondary"
                    size="sm"
                    onClick={() =>
                      handleUpdateQuantity(item.productId, item.quantity - 1)
                    }
                    disabled={isProcessing || item.quantity <= 1}
                  >
                    <Minus />
                  </Button>
                  <span className="w-8 text-center font-medium">
                    {item.quantity}
                  </span>
                  <Button
                    variant="ghost"
                    color="secondary"
                    size="sm"
                    onClick={() =>
                      handleUpdateQuantity(item.productId, item.quantity + 1)
                    }
                    disabled={isProcessing}
                  >
                    <Plus />
                  </Button>
                </div>

                <div className="text-right min-w-[80px]">
                  <p className="font-semibold text-primary">
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  color="secondary"
                  size="sm"
                  onClick={() =>
                    handleRemoveItem(item.productId, item.productName)
                  }
                  disabled={isProcessing}
                >
                  <Trash />
                </Button>
              </div>
            ))}
          </div>

          <div className="border-t border-default pt-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-secondary">Items ({props.itemCount})</span>
              <span className="text-primary">${props.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center mb-6">
              <span className="heading-md">Total</span>
              <span className="heading-lg">${props.subtotal.toFixed(2)}</span>
            </div>

            <Button
              variant="solid"
              color="primary"
              onClick={handleCheckout}
              disabled={isProcessing}
              className="w-full"
            >
              {isProcessing ? "Processing..." : "Proceed to Checkout"}
            </Button>
          </div>
        </div>
      </AppsSDKUIProvider>
    </McpUseProvider>
  );
};

export default CartView;
