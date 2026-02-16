# Quick Start

Build your first MCP server tool in 5 minutes.

## Setup

```bash
# Create new project
npx create-mcp-use-app my-server

# Start development server
cd my-server
npm run dev
```

This opens the inspector at `http://localhost:3000/inspector` where you can test your server.

---

## Your First Tool

Open `index.ts` and you'll see a basic server. Let's add a simple tool:

```typescript
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  title: "My Server",
  version: "1.0.0",
  baseUrl: process.env.MCP_URL || "http://localhost:3000"
});

// Add this tool
server.tool(
  {
    name: "greet",
    description: "Greet a user by name",
    schema: z.object({
      name: z.string().describe("User's name")
    })
  },
  async ({ name }) => {
    return text(`Hello, ${name}! Welcome to MCP.`);
  }
);

server.listen();
```

**Save the file** - the server auto-reloads!

**Test it:**
1. Open inspector (`http://localhost:3000/inspector`)
2. Click "List Tools"
3. Find "greet" tool
4. Click "Call Tool"
5. Enter `{"name": "Alice"}`
6. See response: "Hello, Alice! Welcome to MCP."

---

## Add Mock Data

Let's build a weather tool with mock data:

```typescript
// Mock weather data
const mockWeather: Record<string, { temp: number; conditions: string }> = {
  "New York": { temp: 22, conditions: "Partly Cloudy" },
  "London": { temp: 15, conditions: "Rainy" },
  "Tokyo": { temp: 28, conditions: "Sunny" },
  "Paris": { temp: 18, conditions: "Overcast" }
};

server.tool(
  {
    name: "get-weather",
    description: "Get current weather for a city",
    schema: z.object({
      city: z.string().describe("City name")
    })
  },
  async ({ city }) => {
    const weather = mockWeather[city];

    if (!weather) {
      return text(`No weather data for ${city}`);
    }

    return text(
      `Weather in ${city}: ${weather.temp}°C, ${weather.conditions}`
    );
  }
);
```

**Test it:**
- Call tool with `{"city": "Tokyo"}`
- Response: "Weather in Tokyo: 28°C, Sunny"

---

## Add Structure

Return structured data with `object()`:

```typescript
import { MCPServer, text, object } from "mcp-use/server";

server.tool(
  {
    name: "get-weather-detailed",
    description: "Get detailed weather information",
    schema: z.object({
      city: z.string().describe("City name")
    })
  },
  async ({ city }) => {
    const weather = mockWeather[city];

    if (!weather) {
      return object({ error: `No data for ${city}` });
    }

    return object({
      city,
      temperature: weather.temp,
      conditions: weather.conditions,
      unit: "celsius",
      timestamp: new Date().toISOString()
    });
  }
);
```

---

## Add a Resource

Resources provide read-only data:

```typescript
server.resource(
  {
    name: "available_cities",
    uri: "weather://available-cities",
    title: "Available Cities",
    description: "List of cities with weather data"
  },
  async () => object({
    cities: Object.keys(mockWeather)
  })
);
```

**Test it:**
1. Inspector → "List Resources"
2. Find "Available Cities"
3. Click "Read Resource"
4. See: `{"cities": ["New York", "London", "Tokyo", "Paris"]}`

---

## Next Steps

**Now that you have the basics:**

1. **Learn response helpers** → [../server/response-helpers.md](../server/response-helpers.md)
2. **Build your first widget** → [../widgets/basics.md](../widgets/basics.md)
3. **See complete examples** → [../patterns/common-patterns.md](../patterns/common-patterns.md)

**Want to add visual UI?** Continue to widgets:
- [Widget Basics](../widgets/basics.md) - Create your first interactive widget
