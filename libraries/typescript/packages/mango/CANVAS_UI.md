# Beautiful Mango Agent UI

The Mango agent now features a beautiful kontextual-inspired split-screen interface!

## 🎨 Features

### Split-Screen Layout
- **Left**: Resizable chat pane (300-800px) with smooth animations
- **Right**: Tabbed view switching between Canvas and Editor
- **Header**: Animated tab switcher with sliding indicator

### Canvas Tab
- **Pan/Zoom Canvas**: Infinite canvas with dot grid background
- **MCP Primitive Cards**: Auto-discovers and displays tools, resources, and prompts
- **Interactive Cards**: Click to execute tools or read resources
- **Real-time Updates**: Polls dev server every 5 seconds for new primitives
- **Grid Layout**: Cards arranged in a 3-column grid

### Editor Tab
- **File Explorer**: Tree view of `/home/user/mcp_project` with collapsible folders
- **Code Editor**: Full-featured editor with:
  - Syntax highlighting
  - Auto-save with Cmd/Ctrl+S
  - Real-time sync to E2B sandbox
  - Unsaved changes indicator
  - Line/character count

### Chat Pane
- **Kontextual Design**: Beautiful message bubbles and animations
- **Thinking Carousel**: Rotating phrases during agent work
- **Tool Call Display**: Expandable cards showing tool executions
- **Resize Handle**: Visual drag handle to adjust width
- **Collapsible**: Button to hide/show chat

## 🚀 Running the UI

```bash
cd libraries/typescript/packages/mango
pnpm dev
```

Then visit: `http://localhost:5173`

## 📁 Key Files

### Components
- `src/client/src/components/chat/ChatPane.tsx` - Main chat interface
- `src/client/src/components/canvas/CanvasViewport.tsx` - Pan/zoom canvas
- `src/client/src/components/canvas/MCPPrimitiveCard.tsx` - MCP primitive cards
- `src/client/src/components/editor/EditorView.tsx` - Editor layout
- `src/client/src/components/editor/FileExplorer.tsx` - File tree
- `src/client/src/components/editor/CodeEditor.tsx` - Code editing
- `src/client/src/components/HeaderTabs.tsx` - Animated tab switcher

### State Management
- `src/client/src/store/app.ts` - Zustand store for all app state

### Server APIs
- `src/server/routes/mcp.ts` - MCP primitives (tools/resources/prompts)
- `src/server/routes/files.ts` - File system operations

## 🎯 User Flow

1. **Start chatting** with the agent to build an MCP server
2. **Watch the canvas** as tools and resources appear as cards
3. **Click cards** to execute tools or read resources
4. **Switch to Editor** tab to view/edit files
5. **Edit code** and it syncs back to the E2B sandbox
6. **Agent updates** automatically reflected in both views

## 🔧 Technical Details

### Dependencies
- **framer-motion**: Smooth animations
- **zustand**: State management
- **lucide-react**: Beautiful icons
- **@radix-ui/***: Accessible UI primitives
- **tailwindcss**: Styling system

### API Endpoints
- `GET /api/mcp/tools` - List tools
- `GET /api/mcp/resources` - List resources  
- `GET /api/mcp/prompts` - List prompts
- `POST /api/mcp/tools/:name/call` - Execute tool
- `POST /api/mcp/resources/read` - Read resource
- `GET /api/files/tree` - Get file tree
- `GET /api/files/content` - Read file
- `POST /api/files/save` - Save file to sandbox

### State Shape
```typescript
{
  activeTab: "canvas" | "editor",
  chatWidth: number,
  canvasPosition: { x, y },
  canvasScale: number,
  mcpPrimitives: {
    tools: [],
    resources: [],
    prompts: []
  },
  selectedFile: string | null,
  fileContents: Map<string, string>,
  devServerUrl: string | null
}
```

## 🎨 Design System

Colors match kontextual:
- Background: `#EEEEEE`
- Chat: White with blur backdrop
- Canvas: Dot grid pattern
- Active tab: `#898315` (olive)
- Text: `#555555` (gray)

All animations use framer-motion with 300ms easeOut transitions.
