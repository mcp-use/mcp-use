import { useMemo } from "react";

export const RandomGradientBackground = ({
  className,
  color,
  children,
  grayscaled = false,
}) => {
  const saturation = useMemo(() => {
    if (color) {
      const values = color.split("(")[1].split(")")[0].trim().split(/\s+/);
      return parseFloat(values[1] || "0");
    }
    return grayscaled ? 0 : 0.2;
  }, [color, grayscaled]);

  const lightness = useMemo(() => {
    if (color) {
      const values = color.split("(")[1].split(")")[0].trim().split(/\s+/);
      return parseFloat(values[0] || "0.5");
    }
    return grayscaled ? 0.3 : 0.4;
  }, [color, grayscaled]);

  const randomHue = useMemo(() => {
    if (color) {
      const values = color.split("(")[1].split(")")[0].trim().split(/\s+/);
      return parseFloat(values[2] || "0");
    }
    return Math.floor(Math.random() * 360);
  }, [color]);

  const randomColor = useMemo(() => {
    if (color) {
      return color;
    }
    return `oklch(${Math.min(lightness, 1)} ${saturation} ${randomHue})`;
  }, [randomHue, saturation, lightness]);

  const lightColor = useMemo(() => {
    return `oklch(${Math.min(lightness * 2, 1)} ${saturation} ${randomHue})`;
  }, [randomHue, saturation, lightness, color]);

  const direction = useMemo(() => {
    return Math.floor(Math.random() * 360);
  }, [randomHue]);

  const brightnessFilter = useMemo(() => {
    return "1000%";
  }, []);

  return (
    <div
      className={`relative overflow-hidden ${className || ""}`}
      style={{
        background: `${lightColor}`,
        minHeight: '100%',
        width: '100%'
      }}
    >
      <div
        className="absolute inset-0 w-full h-full"
        style={{
          background: `linear-gradient(${direction}deg, ${randomColor}, transparent), url(https://grainy-gradients.vercel.app/noise.svg)`,
          filter: `contrast(120%) brightness(${brightnessFilter})`,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat'
        }}
      />
      {children && (
        <div className="relative z-10 w-full h-full">{children}</div>
      )}
    </div>
  );
}
