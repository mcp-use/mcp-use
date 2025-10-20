import React from "react";

export const SimpleSplitCard = ({
  img,
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
    <div className={`border border-zinc-800 rounded-2xl flex flex-col overflow-hidden ${className || ""}`}>
      <div className="relative group overflow-hidden">
        <img
          src={img}
          alt={imgAlt || title}
          className="w-full h-48 object-cover group-hover:scale-105 group-hover:blur-lg transition-all duration-300"
        />
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="grid grid-cols-2 h-full">
            <a href={leftHref} className="flex items-center justify-center bg-black/20 hover:bg-black/50 transition-colors" aria-label={leftLabel}>
              <img src={leftLogo} alt={leftLabel} className="h-10 w-10 filter grayscale" />
            </a>
            <a href={rightHref} className="flex items-center justify-center bg-black/20 hover:bg-black/50 transition-colors" aria-label={rightLabel}>
              <img src={rightLogo} alt={rightLabel} className="h-10 w-10 filter grayscale" />
            </a>
          </div>
        </div>
      </div>
      <div className="p-4 flex-grow flex flex-col">
        <h3 className="font-semibold text-zinc-100">{title}</h3>
        <p className="text-zinc-400 text-sm mt-1 flex-grow">{description}</p>
        <div className="mt-4 flex items-center justify-between text-sm">
          <a href={leftHref} className="flex items-center text-zinc-300 hover:text-white transition-colors">
            <img src={leftLogo} alt={leftLabel} className="h-5 w-5 mr-2 filter grayscale" />
            <span>{leftLabel}</span>
          </a>
          <a href={rightHref} className="flex items-center text-zinc-300 hover:text-white transition-colors">
            <img src={rightLogo} alt={rightLabel} className="h-5 w-5 mr-2 filter grayscale" />
            <span>{rightLabel}</span>
          </a>
        </div>
      </div>
    </div>
  );
};
