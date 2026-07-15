import { useToolContext } from "@mcp-use/server/react";

export default function WeatherDisplay() {
  const tool = useToolContext();

  if (tool.status !== "ready") {
    return <p>Loading weather…</p>;
  }
  const output = tool.toolOutput as {
    city: string;
    conditions: string;
    temperature: number;
  };

  return (
    <article>
      <p>Weather view v1</p>
      <h1>{output.city}</h1>
      <p>{output.conditions}</p>
      <p>{output.temperature}°C</p>
    </article>
  );
}
