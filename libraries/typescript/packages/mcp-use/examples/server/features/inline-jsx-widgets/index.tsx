/** @jsxImportSource mcp-use/jsx */

/**
 * Inline JSX Widgets Example
 *
 * Demonstrates:
 * - <Component .../> inline JSX returns from tool handlers
 * - _csp and _prefersBorder for per-call widget config
 * - useCallTool(toolRef) typed tool calls from within widgets
 * - Display mode, sendFollowUpMessage, openExternal
 * - _fileParams for file-accepting tools
 * - streamable() for incremental prop updates
 * - ctx.client.supportsApps() conditional returns
 * - defineTools() for batch registration + typed map
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

// ─── 1. Inline JSX with CSP + prefersBorder ──────────────────────────────────

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

// ─── 2. Conditional return ───────────────────────────────────────────────────

server.tool(
  {
    name: "get-status",
    description: "System status. Widget for MCP Apps clients, text for others.",
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

// ─── 3. Streamable props ─────────────────────────────────────────────────────

server.tool(
  {
    name: "analyze-text",
    description: "Analyze text with streaming progress.",
    schema: z.object({ text: z.string() }),
  },
  async ({ text: inputText }, ctx) => {
    const analysis = streamable("");

    (async () => {
      const words = inputText.split(" ");
      for (let i = 0; i < words.length; i++) {
        await new Promise((r) => setTimeout(r, 300));
        analysis.update((prev) => prev + (prev ? " " : "") + words[i].toUpperCase());
      }
      analysis.done();
    })();

    if (ctx.client.supportsApps()) {
      return (
        <AnalysisView
          text={inputText}
          analysis={analysis}
          _output={text("Analysis in progress...")}
          _invoking="Analyzing..."
          _invoked="Analysis complete"
          _prefersBorder={true}
        />
      );
    }

    const finalAnalysis = await analysis.value;
    return text(`Analysis: ${finalAnalysis}`);
  }
);

// ─── 4. File handling tool ───────────────────────────────────────────────────

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

// ─── 5. defineTools ──────────────────────────────────────────────────────────

export const tools = server.defineTools({
  echo: {
    description: "Echo back the input.",
    schema: z.object({ message: z.string() }),
    handler: async ({ message }) => text(`Echo: ${message}`),
  },
});

// ─── Start ───────────────────────────────────────────────────────────────────

await server.listen();

console.log(`
Inline JSX Widgets Example
  Tools: get-weather, get-status, analyze-text, preview-file, echo
  Pattern: return <Component .../> directly from tool handlers
  Widget features: _csp, _prefersBorder, useCallTool, displayMode, sendFollowUp, fileParams
`);
