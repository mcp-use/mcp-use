import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import type { McpPrimitives } from "../../types.js";
import {
  PromptNode,
  ResourceNode,
  ToolNode,
  WidgetNode,
  isWidgetResource,
} from "./nodes/index.js";

export interface CanvasPanelProps {
  primitives: McpPrimitives | null;
  projectName?: string;
}

const nodeTypes = {
  tool: ToolNode,
  resource: ResourceNode,
  prompt: PromptNode,
  widget: WidgetNode,
};

/**
 * Canvas panel component with React Flow
 */
export function CanvasPanel({ primitives, projectName }: CanvasPanelProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Generate nodes from primitives
  useEffect(() => {
    if (!primitives) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const newNodes: Node[] = [];
    const yOffset = 50;
    const xSpacing = 300;
    const ySpacing = 150;

    // Add tool nodes (left column)
    primitives.tools.forEach((tool, idx) => {
      newNodes.push({
        id: `tool-${idx}`,
        type: "tool",
        position: { x: 50, y: yOffset + idx * ySpacing },
        data: { ...tool, projectName },
      });
    });

    // Add resource nodes (middle column)
    const resourcesWithoutWidgets = primitives.resources.filter(
      (r) => !isWidgetResource(r)
    );
    resourcesWithoutWidgets.forEach((resource, idx) => {
      newNodes.push({
        id: `resource-${idx}`,
        type: "resource",
        position: { x: 50 + xSpacing, y: yOffset + idx * ySpacing },
        data: { ...resource, projectName },
      });
    });

    // Add prompt nodes (middle-right column)
    primitives.prompts.forEach((prompt, idx) => {
      newNodes.push({
        id: `prompt-${idx}`,
        type: "prompt",
        position: { x: 50 + xSpacing * 2, y: yOffset + idx * ySpacing },
        data: { ...prompt, projectName },
      });
    });

    // Add widget nodes (right column)
    const widgets = primitives.resources.filter((r) => isWidgetResource(r));
    widgets.forEach((widget, idx) => {
      newNodes.push({
        id: `widget-${idx}`,
        type: "widget",
        position: { x: 50 + xSpacing * 3, y: yOffset + idx * ySpacing },
        data: { ...widget, projectName, isWidget: true },
      });
    });

    setNodes(newNodes);
    setEdges([]);
  }, [primitives, projectName, setNodes, setEdges]);

  const emptyState = useMemo(() => {
    if (!primitives) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-6xl">🎨</div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Canvas</h2>
              <p className="text-muted-foreground">
                MCP primitives will appear here
              </p>
            </div>
            <div className="text-sm text-muted-foreground max-w-md">
              Once Mango creates and connects to an MCP server, you'll see
              tools, resources, prompts, and widgets visualized as nodes on this
              canvas.
            </div>
          </div>
        </div>
      );
    }

    if (
      primitives.tools.length === 0 &&
      primitives.resources.length === 0 &&
      primitives.prompts.length === 0
    ) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-muted-foreground">
              No primitives found in the connected server
            </p>
          </div>
        </div>
      );
    }

    return null;
  }, [primitives]);

  if (emptyState) {
    return <div className="h-full bg-background">{emptyState}</div>;
  }

  return (
    <div className="h-full bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Canvas</h2>
            {projectName && (
              <p className="text-xs text-muted-foreground">
                Connected to: {projectName}
              </p>
            )}
          </div>
          {primitives && (
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>Tools: {primitives.tools.length}</span>
              <span>Resources: {primitives.resources.length}</span>
              <span>Prompts: {primitives.prompts.length}</span>
            </div>
          )}
        </div>
      </div>

      <div className="h-[calc(100%-60px)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
