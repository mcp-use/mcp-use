# UI MCP Server

An MCP server with React UI widgets created with `create-mcp-app` that provides interactive web components for MCP clients.

## Features

- **🎨 React Components**: Interactive UI widgets built with React
- **🔥 Hot Reloading**: Development server with instant updates
- **📦 Production Builds**: Optimized bundles for production
- **🌐 Web Endpoints**: Serve widgets at `/mcp-use/widgets/{widget-name}`
- **🛠️ Development Tools**: Full TypeScript support and modern tooling

## Getting Started

### Development

```bash
# Install dependencies
npm install

# Start development server with hot reloading
npm run dev
```

This will start:

- MCP server on port 3000
- Vite dev server on port 3001 with hot reloading

### Production

```bash
# Build the server and UI components
npm run build

# Run the built server
npm start
```

## Available Widgets

### 1. Kanban Board (`/mcp-use/widgets/kanban-board`)

Interactive Kanban board for task management.

**Features:**

- Drag and drop tasks between columns
- Add/remove tasks
- Priority levels and assignees
- Real-time updates

**Usage:**

```typescript
mcp.tool({
  name: 'show-kanban',
  inputs: [{ name: 'tasks', type: 'string', required: true }],
  cb: async ({ tasks }) => {
    // Display Kanban board with tasks
  },
})
```

### 2. Todo List (`/mcp-use/widgets/todo-list`)

Interactive todo list with filtering and sorting.

**Features:**

- Add/complete/delete todos
- Filter by status (all/active/completed)
- Sort by priority, due date, or creation time
- Progress tracking
- Categories and due dates

**Usage:**

```typescript
mcp.tool({
  name: 'show-todo-list',
  inputs: [{ name: 'todos', type: 'string', required: true }],
  cb: async ({ todos }) => {
    // Display todo list with todos
  },
})
```

### 3. Data Visualization (`/mcp-use/widgets/data-visualization`)

Interactive charts and data visualization.

**Features:**

- Bar charts, line charts, and pie charts
- Add/remove data points
- Interactive legends
- Data table view
- Multiple chart types

**Usage:**

```typescript
mcp.tool({
  name: 'show-data-viz',
  inputs: [
    { name: 'data', type: 'string', required: true },
    { name: 'chartType', type: 'string', required: false },
  ],
  cb: async ({ data, chartType }) => {
    // Display data visualization
  },
})
```

## Development Workflow

### 1. Create a New Widget

1. **Create the React component:**

   ```bash
   # Create resources/my-widget.tsx
   touch resources/my-widget.tsx
   ```

2. **Create the HTML entry point:**

   ```bash
   # Create resources/my-widget.html
   touch resources/my-widget.html
   ```

3. **Add to Vite config:**

   ```typescript
   // vite.config.ts
   rollupOptions: {
     input: {
       'my-widget': resolve(__dirname, 'resources/my-widget.html')
     }
   }
   ```

4. **Add MCP resource:**
   ```typescript
   // src/server.ts
   mcp.resource({
     uri: 'ui://widget/my-widget',
     name: 'My Widget',
     mimeType: 'text/html+skybridge',
     readCallback: async () => {
       const widgetUrl = `http://localhost:${PORT}/mcp-use/widgets/my-widget`
       return `<div id="my-widget-root"></div><script type="module" src="${widgetUrl}"></script>`
     },
   })
   ```

### 2. Development with Hot Reloading

```bash
# Start development
npm run dev

# Visit your widget
open http://localhost:3001/my-widget.html
```

Changes to your React components will automatically reload!

### 3. Widget Development Best Practices

#### Component Structure

```typescript
import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

interface MyWidgetProps {
  initialData?: any
}

const MyWidget: React.FC<MyWidgetProps> = ({ initialData = [] }) => {
  const [data, setData] = useState(initialData)

  // Load data from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const dataParam = urlParams.get('data')

    if (dataParam) {
      try {
        const parsedData = JSON.parse(decodeURIComponent(dataParam))
        setData(parsedData)
      } catch (error) {
        console.error('Error parsing data:', error)
      }
    }
  }, [])

  return <div>{/* Your widget content */}</div>
}

// Render the component
const container = document.getElementById('my-widget-root')
if (container) {
  const root = createRoot(container)
  root.render(<MyWidget />)
}
```

#### Styling Guidelines

- Use inline styles for simplicity
- Follow the existing design system
- Ensure responsive design
- Use consistent color palette

#### Data Handling

- Accept data via URL parameters
- Provide sensible defaults
- Handle errors gracefully
- Use TypeScript for type safety

### 4. Production Deployment

```bash
# Build everything
npm run build

# The built files will be in dist/
# - dist/index.js (MCP server entry point)
# - dist/src/server.js (MCP server implementation)
# - dist/resources/ (Compiled TypeScript + UI widget bundles)
```

## Project Structure

```
my-ui-server/
├── index.ts                   # Entry point (re-exports server)
├── src/
│   └── server.ts              # MCP server with UI endpoints
├── resources/                 # React components (TSX widgets)
│   ├── kanban-board.tsx
│   ├── todo-list.tsx
│   └── data-visualization.tsx
├── dist/                      # Built files
│   ├── index.js               # Entry point
│   ├── src/
│   │   └── server.js          # Server implementation
│   └── resources/             # TypeScript output + bundled widgets
├── package.json
├── tsconfig.json
└── README.md
```

## API Reference

### MCP Resources

All UI widgets are available as MCP resources:

- `ui://status` - Server status and available widgets
- `ui://widget/kanban-board` - Kanban board widget
- `ui://widget/todo-list` - Todo list widget
- `ui://widget/data-visualization` - Data visualization widget

### MCP Tools

- `show-kanban` - Display Kanban board with tasks
- `show-todo-list` - Display todo list with items
- `show-data-viz` - Display data visualization

### MCP Prompts

- `ui-development` - Generate UI development guidance

## Customization

### Adding New Dependencies

```bash
# Add React libraries
npm install @types/react-router-dom react-router-dom

# Add UI libraries
npm install @mui/material @emotion/react @emotion/styled
```

### Environment Variables

Create a `.env` file:

```bash
# Server configuration
PORT=3000
NODE_ENV=development

# UI configuration
VITE_API_URL=http://localhost:3000
```

### Custom Build Configuration

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        'my-custom-widget': resolve(
          __dirname,
          'resources/my-custom-widget.html'
        ),
      },
    },
  },
})
```

## Troubleshooting

### Common Issues

1. **"Cannot find module" errors**

   - Make sure all dependencies are installed: `npm install`
   - Check that TypeScript paths are correct

2. **Hot reloading not working**

   - Ensure Vite dev server is running on port 3001
   - Check that the widget HTML file exists

3. **Widget not loading**

   - Verify the widget is added to vite.config.ts
   - Check that the MCP resource is properly configured

4. **Build errors**
   - Run `npm run build` to see detailed error messages
   - Check that all imports are correct

### Development Tips

- Use browser dev tools to debug React components
- Check the Network tab for failed requests
- Use React DevTools browser extension
- Monitor console for errors

## Learn More

- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vitejs.dev/)
- [MCP Documentation](https://modelcontextprotocol.io)
- [mcp-use Documentation](https://docs.mcp-use.io)

## Examples

### Simple Counter Widget

```typescript
// resources/counter.tsx
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'

const Counter: React.FC = () => {
  const [count, setCount] = useState(0)

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>Counter: {count}</h1>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <button onClick={() => setCount(count - 1)}>Decrement</button>
    </div>
  )
}

const container = document.getElementById('counter-root')
if (container) {
  const root = createRoot(container)
  root.render(<Counter />)
}
```

### Data Table Widget

```typescript
// resources/data-table.tsx
import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

interface TableData {
  id: string
  name: string
  value: number
}

const DataTable: React.FC = () => {
  const [data, setData] = useState<TableData[]>([])

  useEffect(() => {
    // Load data from URL or use defaults
    const urlParams = new URLSearchParams(window.location.search)
    const dataParam = urlParams.get('data')

    if (dataParam) {
      try {
        setData(JSON.parse(decodeURIComponent(dataParam)))
      } catch (error) {
        console.error('Error parsing data:', error)
      }
    }
  }, [])

  return (
    <div style={{ padding: '20px' }}>
      <h1>Data Table</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const container = document.getElementById('data-table-root')
if (container) {
  const root = createRoot(container)
  root.render(<DataTable />)
}
```

Happy coding! 🚀
