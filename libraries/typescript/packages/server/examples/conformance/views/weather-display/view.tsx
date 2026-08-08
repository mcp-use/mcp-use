import {
  ThemeProvider,
  ViewControls,
  useHostContext,
  useToolContext,
} from "mcp-use/react";

interface InspectorHostContext {
  platform?: string;
  deviceCapabilities?: { touch?: boolean };
}

const levelStyle = {
  border: "1px solid color-mix(in srgb, currentColor 15%, transparent)",
  borderRadius: 24,
  padding: 32,
} as const;

function WeatherDisplayContent() {
  const view = useToolContext<"get-weather-delayed">();
  const {
    hostContext,
    locale,
    maxHeight,
    maxWidth,
    safeArea,
    theme,
    timeZone,
  } = useHostContext();
  const inspectorHost = hostContext as InspectorHostContext | undefined;
  const isDark = theme === "dark";

  const shellStyle = {
    ...levelStyle,
    background: isDark
      ? "linear-gradient(135deg, #2e1065, #1e1b4b)"
      : "linear-gradient(135deg, #faf5ff, #ede9fe)",
    color: isDark ? "#f5f3ff" : "#1f2937",
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as const;

  if (view.status === "pending") {
    return (
      <div style={shellStyle}>
        <div
          className="animate-spin"
          aria-label="Loading weather"
          style={{
            width: 48,
            height: 48,
            margin: "0 auto",
            border: "4px solid #c4b5fd",
            borderTopColor: "#7c3aed",
            borderRadius: "50%",
          }}
        />
      </div>
    );
  }

  if (view.status === "error") {
    return (
      <div style={shellStyle} role="alert">
        Weather lookup failed: {view.error.message}
      </div>
    );
  }

  const weather = view.toolOutput;
  const platform = inspectorHost?.platform ?? "unknown";
  const hasTouch = inspectorHost?.deviceCapabilities?.touch ?? false;

  return (
    <article style={shellStyle}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 24,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 30 }}>{weather.city}</h1>
          <p style={{ margin: "4px 0 0", textTransform: "capitalize" }}>
            {weather.conditions}
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 44, fontWeight: 700 }}>
          {weather.temperature}°
        </p>
      </header>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 16,
          margin: 0,
        }}
      >
        <div>
          <dt>Humidity</dt>
          <dd style={{ margin: "4px 0 0", fontWeight: 600 }}>
            {weather.humidity}%
          </dd>
        </div>
        <div>
          <dt>Wind Speed</dt>
          <dd style={{ margin: "4px 0 0", fontWeight: 600 }}>
            {weather.windSpeed} km/h
          </dd>
        </div>
      </dl>

      <section
        style={{
          marginTop: 24,
          padding: 16,
          borderRadius: 12,
          background: isDark ? "rgba(0, 0, 0, 0.2)" : "rgba(255,255,255,0.65)",
        }}
      >
        <p style={{ margin: "0 0 12px", fontWeight: 600 }}>
          Host Context Settings
        </p>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
            margin: 0,
            fontSize: 12,
          }}
        >
          <div>Device: {platform}</div>
          <div>Locale: {locale}</div>
          <div>Timezone: {timeZone}</div>
          <div>Touch: {hasTouch ? "Yes" : "No"}</div>
          <div>{`Viewport: ${maxWidth ?? "auto"}x${maxHeight ?? "auto"}`}</div>
          <div>{`Safe Area: ${safeArea.top}/${safeArea.right}/${safeArea.bottom}/${safeArea.left}`}</div>
        </dl>
      </section>
    </article>
  );
}

export default function WeatherDisplay() {
  return (
    <ThemeProvider>
      <ViewControls debugger viewControls>
        <WeatherDisplayContent />
      </ViewControls>
    </ThemeProvider>
  );
}
