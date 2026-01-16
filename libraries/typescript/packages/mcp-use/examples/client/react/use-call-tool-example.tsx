import { useMcp, useCallTool, type TypedMcpServer } from "mcp-use/react";
import React from "react";

/**
 * Example demonstrating the useCallTool hook with MCP server
 *
 * The useCallTool hook provides:
 * - Type-safe tool calling with generic types
 * - React Query-style loading states (isPending, isSuccess, isError)
 * - Two calling patterns: fire-and-forget (callTool) and async/await (callToolAsync)
 * - Lifecycle callbacks (onSuccess, onError, onSettled)
 * - Autocomplete for tool names via ToolRegistry pattern
 */

// ============================================================
// Define your tool types for autocomplete support
// ============================================================

type WeatherInput = {
  city: string;
  units?: "celsius" | "fahrenheit";
};

type WeatherOutput = {
  city: string;
  temperature: number;
  conditions: string;
  humidity?: number;
  windSpeed?: number;
};

type EmailInput = {
  to: string;
  subject: string;
  body: string;
};

type EmailOutput = {
  messageId: string;
  status: "sent" | "queued" | "failed";
};

// Create a tool registry for type-safe autocomplete
type MyServerTools = {
  "get-weather": { input: WeatherInput; output: WeatherOutput };
  "send-email": { input: EmailInput; output: EmailOutput };
  "list-tasks": { input: { userId: string }; output: { tasks: string[] } };
};

const UseCallToolExample: React.FC = () => {
  const [city, setCity] = React.useState("Paris");
  const [lastResult, setLastResult] = React.useState<WeatherOutput | null>(
    null
  );

  // Connect to MCP server
  const mcp = useMcp({
    url: "http://localhost:3000/mcp",
  });

  // ============================================================
  // Option 1: Type-safe with tool registry (recommended)
  // ============================================================

  // Cast to typed server for autocomplete
  const typedServer = mcp as TypedMcpServer<MyServerTools>;

  // Tool names will autocomplete!
  const weatherHook = useCallTool(
    typedServer,
    "get-weather", // <-- autocompletes: "get-weather", "send-email", "list-tasks"
    {
      onSuccess: (data) => {
        console.log("Weather fetched successfully:", data);
        setLastResult(data);
      },
      onError: (error) => {
        console.error("Failed to fetch weather:", error.message);
      },
      onSettled: (data, error) => {
        console.log("Tool call completed", { data, error });
      },
      timeout: 30000,
    }
  );

  // ============================================================
  // Option 2: Simple untyped usage
  // ============================================================

  const emailHook = useCallTool<EmailInput, EmailOutput>(
    mcp, // Pass server object directly
    "send-email"
  );

  // Handler using fire-and-forget pattern
  const handleGetWeather = () => {
    weatherHook.callTool({ city });
  };

  // Handler using async/await pattern
  const handleGetWeatherAsync = async () => {
    try {
      const result = await weatherHook.callToolAsync({ city });
      console.log("Got weather data:", result);
      alert(`Temperature in ${result.city}: ${result.temperature}°C`);
    } catch (error) {
      console.error("Error:", error);
    }
  };

  // Handler for sending email
  const handleSendEmail = async () => {
    try {
      const result = await emailHook.callToolAsync({
        to: "user@example.com",
        subject: "Weather Update",
        body: `Current weather in ${city}: ${lastResult?.temperature}°C`,
      });
      alert(`Email ${result.status}! ID: ${result.messageId}`);
    } catch (error) {
      console.error("Failed to send email:", error);
    }
  };

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h1>useCallTool Hook Example</h1>

      {/* MCP Connection Status */}
      <div
        style={{
          marginBottom: "20px",
          padding: "10px",
          backgroundColor: mcp.state === "ready" ? "#d4edda" : "#fff3cd",
          border: `1px solid ${mcp.state === "ready" ? "#c3e6cb" : "#ffc107"}`,
          borderRadius: "4px",
        }}
      >
        <strong>MCP Status:</strong> {mcp.state.toUpperCase()}
      </div>

      {mcp.state === "ready" && (
        <>
          {/* Example 1: Weather Tool */}
          <div
            style={{
              marginBottom: "30px",
              padding: "20px",
              border: "1px solid #dee2e6",
              borderRadius: "8px",
              backgroundColor: "#f8f9fa",
            }}
          >
            <h2>Example 1: Get Weather (Typed)</h2>
            <p>
              Demonstrates type-safe tool calling with loading states and
              callbacks
            </p>

            <div style={{ marginBottom: "15px" }}>
              <label style={{ display: "block", marginBottom: "5px" }}>
                City:
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                style={{
                  padding: "8px",
                  border: "1px solid #ced4da",
                  borderRadius: "4px",
                  width: "200px",
                }}
              />
            </div>

            <div style={{ marginBottom: "15px", display: "flex", gap: "10px" }}>
              <button
                onClick={handleGetWeather}
                disabled={weatherHook.isPending}
                style={{
                  padding: "10px 20px",
                  backgroundColor: weatherHook.isPending
                    ? "#6c757d"
                    : "#007bff",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: weatherHook.isPending ? "not-allowed" : "pointer",
                }}
              >
                {weatherHook.isPending
                  ? "Loading..."
                  : "Get Weather (Fire & Forget)"}
              </button>

              <button
                onClick={handleGetWeatherAsync}
                disabled={weatherHook.isPending}
                style={{
                  padding: "10px 20px",
                  backgroundColor: weatherHook.isPending
                    ? "#6c757d"
                    : "#28a745",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: weatherHook.isPending ? "not-allowed" : "pointer",
                }}
              >
                {weatherHook.isPending
                  ? "Loading..."
                  : "Get Weather (Async/Await)"}
              </button>

              {weatherHook.data && (
                <button
                  onClick={weatherHook.reset}
                  style={{
                    padding: "10px 20px",
                    backgroundColor: "#6c757d",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Reset
                </button>
              )}
            </div>

            {/* Loading States */}
            <div style={{ marginBottom: "10px", fontSize: "0.9em" }}>
              <strong>States:</strong>{" "}
              <span
                style={{ color: weatherHook.isIdle ? "#28a745" : "#6c757d" }}
              >
                Idle: {weatherHook.isIdle ? "✓" : "✗"}
              </span>
              {" | "}
              <span
                style={{ color: weatherHook.isPending ? "#ffc107" : "#6c757d" }}
              >
                Pending: {weatherHook.isPending ? "✓" : "✗"}
              </span>
              {" | "}
              <span
                style={{ color: weatherHook.isSuccess ? "#28a745" : "#6c757d" }}
              >
                Success: {weatherHook.isSuccess ? "✓" : "✗"}
              </span>
              {" | "}
              <span
                style={{ color: weatherHook.isError ? "#dc3545" : "#6c757d" }}
              >
                Error: {weatherHook.isError ? "✓" : "✗"}
              </span>
            </div>

            {/* Result Display */}
            {weatherHook.isSuccess && weatherHook.data && (
              <div
                style={{
                  marginTop: "15px",
                  padding: "15px",
                  backgroundColor: "#d4edda",
                  border: "1px solid #c3e6cb",
                  borderRadius: "4px",
                }}
              >
                <h4 style={{ margin: "0 0 10px 0", color: "#155724" }}>
                  Weather Result:
                </h4>
                <div style={{ color: "#155724" }}>
                  <p>
                    <strong>City:</strong> {weatherHook.data.city}
                  </p>
                  <p>
                    <strong>Temperature:</strong> {weatherHook.data.temperature}
                    °C
                  </p>
                  <p>
                    <strong>Conditions:</strong> {weatherHook.data.conditions}
                  </p>
                  {weatherHook.data.humidity && (
                    <p>
                      <strong>Humidity:</strong> {weatherHook.data.humidity}%
                    </p>
                  )}
                  {weatherHook.data.windSpeed && (
                    <p>
                      <strong>Wind Speed:</strong> {weatherHook.data.windSpeed}{" "}
                      km/h
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Error Display */}
            {weatherHook.isError && weatherHook.error && (
              <div
                style={{
                  marginTop: "15px",
                  padding: "15px",
                  backgroundColor: "#f8d7da",
                  border: "1px solid #f5c6cb",
                  borderRadius: "4px",
                  color: "#721c24",
                }}
              >
                <h4 style={{ margin: "0 0 10px 0" }}>Error:</h4>
                <p style={{ margin: 0 }}>{weatherHook.error.message}</p>
              </div>
            )}
          </div>

          {/* Example 2: Send Email Tool */}
          <div
            style={{
              marginBottom: "30px",
              padding: "20px",
              border: "1px solid #dee2e6",
              borderRadius: "8px",
              backgroundColor: "#f8f9fa",
            }}
          >
            <h2>Example 2: Send Email</h2>
            <p>Demonstrates chaining multiple tool calls</p>

            <button
              onClick={handleSendEmail}
              disabled={emailHook.isPending || !lastResult}
              style={{
                padding: "10px 20px",
                backgroundColor:
                  !lastResult || emailHook.isPending ? "#6c757d" : "#17a2b8",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor:
                  !lastResult || emailHook.isPending
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {emailHook.isPending ? "Sending..." : "Send Weather Email"}
            </button>

            {!lastResult && (
              <p
                style={{
                  marginTop: "10px",
                  fontSize: "0.9em",
                  color: "#6c757d",
                }}
              >
                Get weather data first to enable this button
              </p>
            )}

            {emailHook.isSuccess && emailHook.data && (
              <div
                style={{
                  marginTop: "15px",
                  padding: "15px",
                  backgroundColor: "#d4edda",
                  border: "1px solid #c3e6cb",
                  borderRadius: "4px",
                  color: "#155724",
                }}
              >
                <p>
                  <strong>Email Status:</strong> {emailHook.data.status}
                </p>
                <p>
                  <strong>Message ID:</strong> {emailHook.data.messageId}
                </p>
              </div>
            )}

            {emailHook.isError && emailHook.error && (
              <div
                style={{
                  marginTop: "15px",
                  padding: "15px",
                  backgroundColor: "#f8d7da",
                  border: "1px solid #f5c6cb",
                  borderRadius: "4px",
                  color: "#721c24",
                }}
              >
                <strong>Error:</strong> {emailHook.error.message}
              </div>
            )}
          </div>

          {/* Code Example */}
          <div
            style={{
              marginTop: "30px",
              padding: "20px",
              backgroundColor: "#e7f3ff",
              border: "1px solid #b3d9ff",
              borderRadius: "4px",
            }}
          >
            <h3>📝 New API - Pass Server Object Directly</h3>
            <pre
              style={{
                backgroundColor: "#ffffff",
                padding: "15px",
                borderRadius: "4px",
                overflow: "auto",
                fontSize: "0.85em",
                border: "1px solid #dee2e6",
              }}
            >
              {`// Define your tool registry for autocomplete
type MyTools = {
  'get-weather': { input: { city: string }; output: { temp: number } };
  'send-email': { input: { to: string }; output: { sent: boolean } };
};

// Connect to MCP server
const mcp = useMcp({ url: 'http://localhost:3000/mcp' });

// Option 1: Type-safe with autocomplete (cast to TypedMcpServer)
const typedServer = mcp as TypedMcpServer<MyTools>;
const hook = useCallTool(typedServer, 'get-weather'); // autocompletes!

// Option 2: Simple usage (pass server directly)
const hook = useCallTool<Input, Output>(mcp, 'get-weather');

// Option 3: Widget context (just pass tool name)
const hook = useCallTool<Input, Output>('get-weather');

// Call the tool
await hook.callToolAsync({ city: 'Paris' });`}
            </pre>

            <h4>Key Features:</h4>
            <ul>
              <li>
                ✅ <strong>Pass server object directly</strong> - No need to
                access .callTool
              </li>
              <li>
                ✅ <strong>Tool name autocomplete</strong> - Via ToolRegistry
                pattern
              </li>
              <li>✅ Full TypeScript type safety with generics</li>
              <li>✅ React Query-style loading states</li>
              <li>✅ Two calling patterns: callbacks or async/await</li>
              <li>✅ Lifecycle callbacks (onSuccess, onError, onSettled)</li>
              <li>✅ Configurable timeout options</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default UseCallToolExample;
