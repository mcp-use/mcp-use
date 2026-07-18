import { Image } from "mcp-use/react";

export interface CarouselItemProps {
  fruit: string;
  color: string;
  isFavorite?: boolean;
  isHighlighted?: boolean;
  onClick: () => void;
  onToggleFavorite?: () => void;
}

function HeartIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    );
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function CarouselItem({
  fruit,
  color,
  isFavorite,
  isHighlighted,
  onClick,
  onToggleFavorite,
}: CarouselItemProps) {
  return (
    <div
      className={`carousel-item shrink-0 size-52 rounded-xl border border-neutral-200 dark:border-neutral-700 ${color}${isHighlighted ? " carousel-item-highlighted" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {onToggleFavorite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={`absolute top-2 right-2 z-10 rounded-full p-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
            isFavorite
              ? "text-red-500"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <HeartIcon filled={isFavorite === true} />
        </button>
      )}
      <div className="carousel-item-bg">
        <Image src={`/fruits/${fruit}.webp`} alt={fruit} />
      </div>
      <div className="carousel-item-content">
        <Image
          src={`/fruits/${fruit}.webp`}
          alt={fruit}
          className="h-24 w-24 object-contain"
        />
      </div>
    </div>
  );
}
