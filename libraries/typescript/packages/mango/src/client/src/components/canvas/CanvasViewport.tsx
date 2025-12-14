import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../../store/app";
import { useChatStream } from "../../hooks/useChatStream";
import { MCPPrimitiveCard } from "./MCPPrimitiveCard";
import { useMcp } from "mcp-use/react";

export function CanvasViewport() {
  const canvasPosition = useAppState((state) => state.canvasPosition);
  const canvasScale = useAppState((state) => state.canvasScale);
  const setCanvasPosition = useAppState((state) => state.setCanvasPosition);
  const setCanvasScale = useAppState((state) => state.setCanvasScale);
  const devServerUrl = useAppState((state) => state.devServerUrl);
  const chatWidth = useAppState((state) => state.chatWidth);

  const { conversationId } = useChatStream();

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Connect to MCP server directly from browser
  const { tools, resources, prompts, state, callTool, readResource } = useMcp({
    url: devServerUrl || undefined,
    enabled: !!devServerUrl,
  });

  const isConnecting = state === "discovering" || state === "connecting";
  const isConnected = state === "ready";

  // Pan zoom functionality
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 0) {
        // Left click only
        setIsDragging(true);
        setDragStart({
          x: e.clientX - canvasPosition.x,
          y: e.clientY - canvasPosition.y,
        });
      }
    },
    [canvasPosition]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setCanvasPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart, setCanvasPosition]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle wheel event with non-passive listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * -0.001;
      const newScale = Math.min(Math.max(0.5, canvasScale + delta), 2);
      setCanvasScale(newScale);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [canvasScale, setCanvasScale]);

  // Optimize transform calculation
  const canvasTransform = useMemo(() => {
    return {
      transform: `translate(${canvasPosition.x}px, ${canvasPosition.y}px) scale(${canvasScale})`,
      transition: isDragging
        ? "none"
        : "transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    };
  }, [canvasPosition.x, canvasPosition.y, canvasScale, isDragging]);

  // Calculate card positions in a grid
  const allPrimitives = useMemo(() => {
    const items: Array<{ type: string; data: any; id: string }> = [];

    (tools || []).forEach((tool, index) => {
      items.push({
        type: "tool",
        data: tool,
        id: `tool-${tool.name || index}`,
      });
    });

    (resources || []).forEach((resource, index) => {
      items.push({
        type: "resource",
        data: resource,
        id: `resource-${resource.uri || index}`,
      });
    });

    (prompts || []).forEach((prompt, index) => {
      items.push({
        type: "prompt",
        data: prompt,
        id: `prompt-${prompt.name || index}`,
      });
    });

    return items;
  }, [tools, resources, prompts]);

  return (
    <div
      className="h-full w-full relative ml-auto"
      style={{ width: `calc(100% - ${chatWidth + 64}px)` }}
    >
      <div className="h-full w-full opacity-100">
        <div
          ref={canvasRef}
          className="react-flow w-full h-full overflow-hidden relative z-0 bg-[#EEEEEE] bg-[radial-gradient(circle,_rgba(0,0,0,0.1)_1px,_transparent_1px)] bg-[length:32px_32px]"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div
            className={`absolute w-full h-full top-0 left-0 ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            <div className="absolute w-full h-full top-0 left-0">
              <div
                className="absolute w-full h-full top-0 left-0"
                style={canvasTransform}
              >
                <div className="absolute w-full h-full top-0 left-0">
                  {/* Empty state */}
                  {!devServerUrl && (
                    <div
                      className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
                      style={{ pointerEvents: "none" }}
                    >
                      <div className="text-center">
                        <p className="text-gray-500 text-lg mb-2">
                          Start chatting to build your MCP server
                        </p>
                        <p className="text-gray-400 text-sm">
                          Tools, resources, and prompts will appear here
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Loading state */}
                  {isConnecting &&
                    devServerUrl &&
                    allPrimitives.length === 0 && (
                      <div
                        className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
                        style={{ pointerEvents: "none" }}
                      >
                        <div className="text-center">
                          <div className="w-8 h-8 border-4 border-gray-300 border-t-gray-600 rounded-full animate-spin mx-auto mb-4" />
                          <p className="text-gray-500">
                            Connecting to MCP server...
                          </p>
                        </div>
                      </div>
                    )}

                  {/* MCP Primitive Cards */}
                  {allPrimitives.map((primitive, index) => {
                    const col = index % 3;
                    const row = Math.floor(index / 3);
                    const x = col * 450 + 100;
                    const y = row * 350 + 100;

                    return (
                      <MCPPrimitiveCard
                        key={primitive.id}
                        type={primitive.type as any}
                        data={primitive.data}
                        position={{ x, y }}
                        callTool={callTool}
                        readResource={readResource}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Zoom indicator */}
      {canvasScale !== 1 && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-black/80 text-white px-4 py-2 rounded-lg text-sm font-medium backdrop-blur-sm">
          Zoom: {Math.round(canvasScale * 100)}%
        </div>
      )}
    </div>
  );
}
