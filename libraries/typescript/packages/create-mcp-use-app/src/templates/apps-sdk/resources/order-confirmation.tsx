import React from "react";
import { z } from "zod";
import { useWidget } from "mcp-use/react";
import {
  Button,
  Card,
  Icon,
  Transition,
} from "@openai/apps-sdk-ui";
import "../styles.css";

const propSchema = z.object({
  orderId: z.string().describe("Order ID"),
  orderDate: z.string().describe("Order date"),
  items: z
    .array(
      z.object({
        id: z.string().describe("Product ID"),
        name: z.string().describe("Product name"),
        quantity: z.number().describe("Quantity ordered"),
        price: z.number().describe("Unit price"),
        image: z.string().url().optional().describe("Product image URL"),
      })
    )
    .describe("Order items"),
  subtotal: z.number().describe("Order subtotal"),
  tax: z.number().describe("Tax amount"),
  shipping: z.number().describe("Shipping cost"),
  total: z.number().describe("Total amount"),
  shippingAddress: z.string().describe("Shipping address"),
  estimatedDelivery: z.string().describe("Estimated delivery date"),
  status: z
    .enum(["pending", "confirmed", "processing", "shipped", "delivered"])
    .describe("Order status"),
});

export const widgetMetadata = {
  description:
    "Display order confirmation with order details, items, and tracking information",
  inputs: propSchema,
};

type OrderConfirmationProps = z.infer<typeof propSchema>;

const OrderConfirmation: React.FC = () => {
  const { props, theme, callTool, sendFollowUpMessage } =
    useWidget<OrderConfirmationProps>();
  const {
    orderId,
    orderDate,
    items,
    subtotal,
    tax,
    shipping,
    total,
    shippingAddress,
    estimatedDelivery,
    status,
  } = props;

  const handleTrackOrder = async () => {
    try {
      await callTool("track-order", {
        orderId: orderId,
      });
      await sendFollowUpMessage(`Tracking order ${orderId}`);
    } catch (error) {
      console.error("Failed to track order:", error);
    }
  };

  const handleViewReceipt = async () => {
    try {
      await callTool("get-receipt", {
        orderId: orderId,
      });
    } catch (error) {
      console.error("Failed to get receipt:", error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "delivered":
        return "text-green-500";
      case "shipped":
        return "text-blue-500";
      case "processing":
        return "text-yellow-500";
      case "confirmed":
        return "text-green-600";
      default:
        return "text-gray-500";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "delivered":
        return "check-circle";
      case "shipped":
        return "truck";
      case "processing":
        return "clock";
      case "confirmed":
        return "check";
      default:
        return "hourglass";
    }
  };

  const bgColor = theme === "dark" ? "bg-gray-900" : "bg-white";
  const textColor = theme === "dark" ? "text-gray-100" : "text-gray-900";
  const subtextColor = theme === "dark" ? "text-gray-400" : "text-gray-600";
  const cardBg = theme === "dark" ? "bg-gray-800" : "bg-gray-50";
  const borderColor =
    theme === "dark" ? "border-gray-700" : "border-gray-200";

  return (
    <div className={`${bgColor} rounded-lg p-6 max-w-4xl mx-auto`}>
      {/* Header */}
      <div className="mb-6 text-center">
        <Transition in={true} timeout={300}>
          <div className="mb-4">
            <Icon
              name="check-circle"
              size={64}
              className="text-green-500 mx-auto mb-2"
            />
            <h1 className={`text-3xl font-bold ${textColor} mb-2`}>
              Order Confirmed!
            </h1>
            <p className={subtextColor}>
              Thank you for your purchase. Your order has been received.
            </p>
          </div>
        </Transition>

        <Card className={`${cardBg} p-4 rounded-lg border ${borderColor} inline-block`}>
          <div className="flex items-center gap-4">
            <div>
              <p className={`${subtextColor} text-sm`}>Order ID</p>
              <p className={`${textColor} font-semibold`}>{orderId}</p>
            </div>
            <div className="h-8 w-px bg-gray-400" />
            <div>
              <p className={`${subtextColor} text-sm`}>Order Date</p>
              <p className={`${textColor} font-semibold`}>{orderDate}</p>
            </div>
            <div className="h-8 w-px bg-gray-400" />
            <div>
              <p className={`${subtextColor} text-sm`}>Status</p>
              <div className="flex items-center gap-2">
                <Icon
                  name={getStatusIcon(status)}
                  size={16}
                  className={getStatusColor(status)}
                />
                <p className={`${getStatusColor(status)} font-semibold capitalize`}>
                  {status}
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Order Items */}
      <div className="mb-6">
        <h2 className={`text-xl font-semibold ${textColor} mb-4`}>Order Items</h2>
        <div className="space-y-3">
          {items.map((item, index) => (
            <Transition
              key={item.id}
              in={true}
              timeout={200}
              style={{ transitionDelay: `${index * 50}ms` }}
            >
              <Card
                className={`${cardBg} p-4 rounded-lg border ${borderColor} flex items-center gap-4`}
              >
                {item.image && (
                  <div className="w-16 h-16 bg-gray-300 rounded-lg overflow-hidden flex-shrink-0">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <h3 className={`font-semibold ${textColor}`}>{item.name}</h3>
                  <p className={`${subtextColor} text-sm`}>
                    Quantity: {item.quantity} × ${item.price.toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`${textColor} font-semibold`}>
                    ${(item.quantity * item.price).toFixed(2)}
                  </p>
                </div>
              </Card>
            </Transition>
          ))}
        </div>
      </div>

      {/* Order Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card className={`${cardBg} p-4 rounded-lg border ${borderColor}`}>
          <h3 className={`text-lg font-semibold ${textColor} mb-4`}>
            Shipping Information
          </h3>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Icon name="location" size={16} className={subtextColor} />
              <div>
                <p className={`${subtextColor} text-sm`}>Shipping Address</p>
                <p className={textColor}>{shippingAddress}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Icon name="calendar" size={16} className={subtextColor} />
              <div>
                <p className={`${subtextColor} text-sm`}>Estimated Delivery</p>
                <p className={textColor}>{estimatedDelivery}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className={`${cardBg} p-4 rounded-lg border ${borderColor}`}>
          <h3 className={`text-lg font-semibold ${textColor} mb-4`}>
            Order Summary
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className={subtextColor}>Subtotal</span>
              <span className={textColor}>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className={subtextColor}>Tax</span>
              <span className={textColor}>${tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className={subtextColor}>Shipping</span>
              <span className={textColor}>${shipping.toFixed(2)}</span>
            </div>
            <div className="border-t pt-2 mt-2 flex justify-between">
              <span className={`${textColor} font-semibold`}>Total</span>
              <span className={`${textColor} font-bold text-xl`}>
                ${total.toFixed(2)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-center">
        <Button variant="outline" onClick={handleViewReceipt}>
          <Icon name="receipt" size={16} className="mr-2" />
          View Receipt
        </Button>
        <Button variant="primary" onClick={handleTrackOrder}>
          <Icon name="truck" size={16} className="mr-2" />
          Track Order
        </Button>
      </div>
    </div>
  );
};

export default OrderConfirmation;
