import { useRef } from "react";
import { CarouselItem } from "./CarouselItem.js";
import { useCarouselAnimation } from "../hooks/useCarouselAnimation.js";

interface CarouselProps {
  results: Array<{ fruit: string; color: string }>;
  favorites?: string[];
  highlighted?: string | null;
  onSelectFruit: (fruit: string) => void;
  onToggleFavorite?: (fruit: string) => void;
}

export function Carousel({
  results,
  favorites = [],
  highlighted = null,
  onSelectFruit,
  onToggleFavorite,
}: CarouselProps) {
  const carouselContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useCarouselAnimation(carouselContainerRef, scrollContainerRef);

  return (
    <div
      ref={scrollContainerRef}
      className="carousel-scroll-container w-full overflow-x-auto overflow-y-visible pl-8"
    >
      <div ref={carouselContainerRef} className="overflow-visible">
        <div className="flex gap-4">
          {results.map((item, index) => {
            const fruit = item.fruit;
            return (
              <CarouselItem
                key={`${fruit}-${index}`}
                fruit={fruit}
                color={item.color}
                isFavorite={favorites.includes(fruit)}
                isHighlighted={highlighted === fruit}
                onClick={() => onSelectFruit(fruit)}
                {...(onToggleFavorite !== undefined && {
                  onToggleFavorite: () => onToggleFavorite(fruit),
                })}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
