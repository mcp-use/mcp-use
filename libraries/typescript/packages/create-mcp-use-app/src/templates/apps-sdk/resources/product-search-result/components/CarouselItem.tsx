import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Icon } from "@openai/apps-sdk-ui/components/Icon";
import { Image, useWidget } from "mcp-use/react";
import React, { useState } from "react";

export interface CarouselItemProps {
  fruit: string;
  color: string;
  name?: string;
  price?: number;
  inStock?: boolean;
  stockCount?: number;
}

export const CarouselItem: React.FC<CarouselItemProps> = ({
  fruit,
  color,
  name,
  price,
  inStock = true,
  stockCount = 0,
}) => {
  const { callTool, sendFollowUpMessage } = useWidget();
  const [isAdding, setIsAdding] = useState(false);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!inStock) return;

    setIsAdding(true);
    try {
      await callTool("add-to-cart", {
        productId: fruit,
        quantity: 1,
      });
      await sendFollowUpMessage(`Added ${name || fruit} to your cart!`);
    } catch (error) {
      console.error("Failed to add to cart:", error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleViewDetails = async () => {
    await sendFollowUpMessage(`Show me details for ${name || fruit}`);
  };

  return (
    <div
      className={`carousel-item relative size-52 rounded-xl border border-subtle ${color} cursor-pointer transition-transform hover:scale-105`}
      onClick={handleViewDetails}
    >
      {/* Stock Badge */}
      {!inStock && (
        <div className="absolute top-2 right-2 z-10">
          <span className="bg-danger text-white text-xs px-2 py-1 rounded-full font-semibold">
            Out of Stock
          </span>
        </div>
      )}

      {inStock && stockCount < 10 && (
        <div className="absolute top-2 right-2 z-10">
          <span className="bg-warning text-white text-xs px-2 py-1 rounded-full font-semibold">
            Only {stockCount} left
          </span>
        </div>
      )}

      <div className="carousel-item-bg">
        <Image src={"/fruits/" + fruit + ".png"} alt={name || fruit} />
      </div>

      <div className="carousel-item-content flex flex-col justify-between">
        <Image
          src={"/fruits/" + fruit + ".png"}
          alt={name || fruit}
          className="w-24 h-24 object-contain"
        />

        <div className="w-full px-2 pb-2">
          {name && (
            <p className="text-sm font-semibold text-center text-primary mb-1 capitalize">
              {name}
            </p>
          )}
          {price !== undefined && (
            <p className="text-lg font-bold text-center text-success mb-2">
              ${price.toFixed(2)}
            </p>
          )}

          <Button
            variant={inStock ? "primary" : "ghost"}
            size="small"
            onClick={handleAddToCart}
            disabled={!inStock || isAdding}
            className="w-full"
          >
            {isAdding ? (
              "Adding..."
            ) : inStock ? (
              <>
                <Icon name="plus" />
                Add to Cart
              </>
            ) : (
              "Unavailable"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
