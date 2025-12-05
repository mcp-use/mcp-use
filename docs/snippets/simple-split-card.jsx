import React from "react";

export const SimpleSplitCard = ({
  imgDark,
  imgLight,
  title,
  description,
  leftHref,
  rightHref,
  leftLogo,
  rightLogo,
  leftLabel = "Python",
  rightLabel = "TypeScript",
  className,
  imgAlt,
}) => {
  return (
    <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex flex-col overflow-hidden ${className || ""}`}>
      <div className="relative group overflow-hidden">
        {/* Light mode image */}
        <img
          src={imgLight}
          alt={imgAlt || title}
          noZoom
          className="w-full h-48 object-cover group-hover:scale-105 group-hover:blur-lg block dark:hidden"
        />
        {/* Dark mode image */}
        <img
          src={imgDark}
          alt={imgAlt || title}
          noZoom
          className="w-full h-48 object-cover group-hover:scale-105 group-hover:blur-lg hidden dark:block"
        />
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100">
          <div className="grid grid-cols-2 h-full">
            <a href={leftHref} className="flex items-center justify-center bg-black/20 hover:bg-black/50" aria-label={leftLabel}>
              <im noZoom src={leftLogo} alt={leftLabel} className="h-10 w-10 filter grayscale" />
            </a>
            <a href={rightHref} className="flex items-center justify-center bg-black/20 hover:bg-black/50" aria-label={rightLabel}>
              <img noZoom src={rightLogo} alt={rightLabel} className="h-10 w-10 filter grayscale" />
            </a>
          </div>
        </div>
      </div>
      <div className="p-4 flex-grow flex flex-col">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm mt-1 flex-grow">{description}</p>
        <div className="mt-4 flex items-center justify-between text-sm">
          <a href={leftHref} className="flex items-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white group">
            <img noZoom src={leftLogo} alt={leftLabel} className="h-5 w-5 mr-2 filter grayscale group-hover:grayscale-0 transition-all duration-200" />
            <span>{leftLabel}</span>
          </a>
          <a href={rightHref} className="flex items-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white group">
            <img noZoom src={rightLogo} alt={rightLabel} className="h-5 w-5 mr-2 filter grayscale group-hover:grayscale-0 transition-all duration-200" />
            <span>{rightLabel}</span>
          </a>
        </div>
      </div>
    </div>
  );
};
