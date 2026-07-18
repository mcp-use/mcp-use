const SKELETON_COUNT = 6;

export function CarouselSkeleton() {
  return (
    <div className="carousel-scroll-container w-full overflow-x-auto overflow-y-visible pl-8">
      <div className="overflow-hidden">
        <div className="flex gap-4">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div
              key={i}
              className="carousel-item shrink-0 size-52 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
