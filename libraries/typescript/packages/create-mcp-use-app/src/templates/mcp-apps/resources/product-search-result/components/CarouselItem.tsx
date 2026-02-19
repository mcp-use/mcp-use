import { Image } from "mcp-use/react";
import React from "react";

export interface CarouselItemProps {
  fruit: string;
  color: string;
  onClick: () => void;
}

export const CarouselItem: React.FC<CarouselItemProps> = ({
  fruit,
  color,
  onClick,
}) => {
  return (
    <div
      className={`carousel-item size-52 rounded-xl border border-subtle ${color} cursor-pointer`}
      onClick={onClick}
    >
      <div className="carousel-item-bg">
        <Image src={"/fruits/" + fruit + ".png"} alt={fruit} />
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
