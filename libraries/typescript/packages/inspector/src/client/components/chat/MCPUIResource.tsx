import { memo, useMemo } from "react";

interface MCPUIResourceProps {
  resource: {
    uri?: string;
    mimeType: string;
    text?: string;
    blob?: string;
  };
}

export const MCPUIResource = memo(({ resource }: MCPUIResourceProps) => {
  if (!resource.uri?.startsWith("ui://")) {
    return null;
  }

  const html = useMemo(() => {
    if (resource.text) return resource.text;
    if (resource.blob) {
      try {
        return atob(resource.blob);
      } catch {
        return null;
      }
    }
    return null;
  }, [resource.text, resource.blob]);

  if (!html) return null;

  return (
    <div className="my-4 p-0 border h-[350px] rounded-2xl border-zinc-200 overflow-hidden bg-card">
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-popups"
        title={resource.uri ?? "MCP UI Resource"}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          overflow: "auto",
        }}
      />
    </div>
  );
});
