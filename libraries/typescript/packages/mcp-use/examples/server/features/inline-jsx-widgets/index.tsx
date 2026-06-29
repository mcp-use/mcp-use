/**
 * Inline JSX Views Example
 *
 * Demonstrates inline JSX returns, streamable props, ToolRef, defineTools, and defineWidget.
 */

import { MCPServer, text, streamable } from "mcp-use/server";
import { z } from "zod";
import WeatherCard from "./components/WeatherCard";
import AnalysisView from "./components/AnalysisView";
import FilePreview from "./components/FilePreview";

const server = new MCPServer({
  name: "inline-jsx-widgets-example",
  version: "1.0.0",
});

export const getWeather = server.tool(
  {
    name: "get-weather",
    description: "Get weather for a city. Returns an interactive weather card.",
    schema: z.object({ city: z.string() }),
  },
  async ({ city }) => {
    const temperature = Math.round(15 + Math.random() * 20);
    const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"][
      Math.floor(Math.random() * 4)
    ];
    const humidity = Math.round(30 + Math.random() * 50);

    return (
      <WeatherCard
        city={city}
        temperature={temperature}
        conditions={conditions}
        humidity={humidity}
        _output={text(`Weather in ${city}: ${temperature}°C, ${conditions}`)}
        _invoking="Fetching weather..."
        _invoked="Weather loaded"
        _csp={{ connectDomains: ["https://api.openweathermap.org"] }}
        _prefersBorder={false}
      />
    );
  }
);

server.tool(
  {
    name: "get-status",
    description: "System status. View for MCP Apps clients, text for others.",
    schema: z.object({}),
  },
  async (_params, ctx) => {
    if (ctx.client.supportsApps()) {
      return (
        <WeatherCard
          city="System HQ"
          temperature={42}
          conditions="operational"
          humidity={99}
          _output={text("System is fully operational")}
          _prefersBorder={true}
        />
      );
    }

    return text("System Status: operational | Health: 42% | Uptime: 99%");
  }
);

server.tool(
  {
    name: "analyze-text",
    description:
      "Analyze text. Demonstrates streamable props, JSX props, and useView().toolInput.",
    schema: z.object({
      text: z.string(),
      streamedProp1: z
        .string()
        .describe(
          "Forwarded by the handler as a JSX prop (structuredContent)."
        ),
      streamedProp2: z
        .string()
        .describe(
          "Read by the view from useView().toolInput — not passed as a prop."
        ),
    }),
  },
  async ({ text: inputText, streamedProp1, streamedProp2 }, ctx) => {
    const analysis = streamable("");
    (async () => {
      const words = inputText.split(" ");
      for (let i = 0; i < words.length; i++) {
        await new Promise((r) => setTimeout(r, 300));
        analysis.update(
          (prev) => prev + (prev ? " " : "") + words[i].toUpperCase()
        );
      }
      analysis.done();
    })();

    await new Promise((r) => setTimeout(r, 3000));

    if (ctx.client.supportsApps()) {
      return (
        <AnalysisView
          text={inputText}
          analysis={analysis}
          streamedProp1={streamedProp1}
          _output={text("Analysis complete")}
          _invoking="Analyzing..."
          _invoked="Analysis complete"
          _prefersBorder={true}
        />
      );
    }

    const finalAnalysis = await analysis.value;
    return text(
      `Analysis: ${finalAnalysis}\nstreamedProp1=${streamedProp1}\nstreamedProp2=${streamedProp2}`
    );
  }
);

server.tool(
  {
    name: "preview-file",
    description: "Preview an uploaded file's contents.",
    schema: z.object({
      file: z.object({
        download_url: z.string(),
        file_id: z.string(),
      }),
    }),
  },
  async ({ file }) => {
    const fileName = file.file_id || "uploaded-file.txt";
    const preview = `File ID: ${file.file_id}\nDownload URL: ${file.download_url}`;

    return (
      <FilePreview
        fileName={fileName}
        fileSize="unknown"
        preview={preview}
        _output={text(`Previewing file: ${fileName}`)}
        _invoking="Loading file..."
        _invoked="File ready"
        _fileParams={["file"]}
        _prefersBorder={true}
      />
    );
  }
);

export const tools = server.defineTools({
  echo: {
    description: "Echo back the input.",
    schema: z.object({ message: z.string() }),
    handler: async ({ message }) => text(`Echo: ${message}`),
  },
});

await server.listen();

console.log(`
Inline JSX Views Example
  Tools: get-weather, get-status, analyze-text, preview-file, echo
  Pattern: return <Component .../> directly from tool handlers
`);
