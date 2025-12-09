import { Animate } from "@openai/apps-sdk-ui/components/Transition";
import { useQuery } from "@tanstack/react-query";
import React, { useRef } from "react";
import { CarouselItem } from "./CarouselItem";
import { useCarouselAnimation } from "../hooks/useCarouselAnimation";

interface CarouselProps {
  mcpUrl: string | undefined;
}

export const Carousel: React.FC<CarouselProps> = ({ mcpUrl }) => {
  const carouselContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Fetch fruits from the API using React Query
  const {
    data: items,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["fruits"],
    queryFn: async () => {
      const response = await fetch(`${mcpUrl}/api/fruits`);
      if (!response.ok) {
        throw new Error("Failed to fetch fruits");
      }
      return response.json() as Promise<
        Array<{ fruit: string; color: string }>
      >;
    },
    enabled: !!mcpUrl, // Only run query if mcpUrl is available
  });

  // Carousel animation with pointer tracking
  useCarouselAnimation(carouselContainerRef, scrollContainerRef);

  return (
    <div
      ref={scrollContainerRef}
      className="carousel-scroll-container w-full overflow-x-auto overflow-y-visible pl-8"
    >
      <div ref={carouselContainerRef} className="overflow-visible">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-secondary">Loading fruits...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-danger">Failed to load fruits</p>
          </div>
        ) : (
          <Animate className="flex gap-4">
            {items?.map((item: { fruit: string; color: string }) => (
              <CarouselItem
                key={item.fruit}
                fruit={item.fruit}
                color={item.color}
              />
            ))}
          </Animate>
        )}
      </div>
    </div>
  );
};
