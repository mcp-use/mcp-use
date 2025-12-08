import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Icon } from "@openai/apps-sdk-ui/components/Icon";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { Link } from "react-router";
import { propSchema, type OrderConfirmationProps } from "./types";
import "../styles.css";

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display order confirmation with order ID, items, total, status, and estimated delivery date. Shows a success message and next steps for the user.",
  inputs: propSchema,
};

const OrderConfirmation: React.FC = () => {
  const { props, sendFollowUpMessage } = useWidget<OrderConfirmationProps>();

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "pending":
        return "text-warning";
      case "confirmed":
        return "text-success";
      case "shipped":
        return "text-info";
      case "delivered":
        return "text-success";
      default:
        return "text-secondary";
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case "pending":
        return "clock";
      case "confirmed":
        return "check-circle";
      case "shipped":
        return "truck";
      case "delivered":
        return "package";
      default:
        return "info";
    }
  };

  return (
    <McpUseProvider debugger viewControls>
      <AppsSDKUIProvider linkComponent={Link}>
        <div className="bg-surface-elevated border border-default rounded-3xl p-8">
          {/* Success Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="check-circle" className="w-8 h-8 text-success" />
            </div>
            <h2 className="heading-xl mb-2">Order Confirmed!</h2>
            <p className="text-secondary">
              Thank you for your order. Your fresh fruits are on their way!
            </p>
          </div>

          {/* Order Details */}
          <div className="bg-surface rounded-2xl p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-sm text-secondary">Order Number</p>
                <p className="heading-md font-mono">{props.orderId}</p>
              </div>
              <div
                className={`flex items-center gap-2 ${getStatusColor(props.status)}`}
              >
                <Icon name={getStatusIcon(props.status)} />
                <span className="font-medium capitalize">{props.status}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-default">
              <div>
                <p className="text-sm text-secondary">Order Date</p>
                <p className="text-primary">{formatDate(props.createdAt)}</p>
              </div>
              <div>
                <p className="text-sm text-secondary">Estimated Delivery</p>
                <p className="text-primary font-medium">
                  {formatDate(props.estimatedDelivery)}
                </p>
              </div>
            </div>
          </div>

          {/* Order Items */}
          <div className="mb-6">
            <h3 className="heading-md mb-4">Order Items</h3>
            <div className="space-y-3">
              {props.items.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 p-3 bg-surface rounded-xl"
                >
                  <img
                    src={item.image}
                    alt={item.productName}
                    className="w-12 h-12 object-cover rounded-lg"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-primary">
                      {item.productName}
                    </p>
                    <p className="text-sm text-secondary">
                      Qty: {item.quantity}
                    </p>
                  </div>
                  <p className="font-semibold text-primary">
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Order Total */}
          <div className="bg-surface rounded-2xl p-6 mb-6">
            <div className="flex justify-between items-center">
              <span className="heading-md">Order Total</span>
              <span className="heading-lg text-success">
                ${props.total.toFixed(2)}
              </span>
            </div>
          </div>

          {/* What's Next */}
          <div className="bg-info/10 rounded-2xl p-6 mb-6">
            <h3 className="heading-sm mb-3 flex items-center gap-2">
              <Icon name="info" className="text-info" />
              What happens next?
            </h3>
            <ul className="space-y-2 text-sm text-secondary">
              <li className="flex items-start gap-2">
                <Icon name="check" className="text-success mt-0.5" />
                <span>You'll receive an email confirmation shortly</span>
              </li>
              <li className="flex items-start gap-2">
                <Icon name="check" className="text-success mt-0.5" />
                <span>
                  We'll send you tracking information when your order ships
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Icon name="check" className="text-success mt-0.5" />
                <span>
                  Your fresh fruits will arrive within 3-5 business days
                </span>
              </li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={() => sendFollowUpMessage("Show me more fruits to buy")}
              className="flex-1"
            >
              Continue Shopping
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                sendFollowUpMessage(
                  `Show me the status of order ${props.orderId}`
                )
              }
            >
              <Icon name="package" />
              Track Order
            </Button>
          </div>
        </div>
      </AppsSDKUIProvider>
    </McpUseProvider>
  );
};

export default OrderConfirmation;
