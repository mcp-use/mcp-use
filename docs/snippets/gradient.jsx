export const RandomGradientBackground = ({
  className,
  color,
  children,
  grayscaled = false,
}) => {
  const values = color
    ? color.split("(")[1].split(")")[0].trim().split(/\s+/)
    : [];
  const saturation = color ? parseFloat(values[1] || "0") : grayscaled ? 0 : 0.2;
  const lightness = color ? parseFloat(values[0] || "0.5") : grayscaled ? 0.3 : 0.4;
  const randomHue = color ? parseFloat(values[2] || "0") : Math.floor(Math.random() * 360);
  const randomColor = color || `oklch(${Math.min(lightness, 1)} ${saturation} ${randomHue})`;
  const lightColor = `oklch(${Math.min(lightness * 2, 1)} ${saturation} ${randomHue})`;
  const direction = Math.floor(Math.random() * 360);
  const brightnessFilter = "1000%";

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
