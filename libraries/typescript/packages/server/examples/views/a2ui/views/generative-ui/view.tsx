import { A2uiSurface, basicCatalog } from "@a2ui/react/v0_9";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { ThemeProvider, useToolContext } from "mcp-use/react";
import { useState } from "react";

import type { UISpec } from "./catalog.js";
import "./view.css";

function GeneratedUI({ spec }: { spec: UISpec }) {
  const [processor] = useState(() => {
    const instance = new MessageProcessor([basicCatalog]);
    instance.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "ui", catalogId: basicCatalog.id },
      },
      {
        version: "v0.9",
        updateComponents: { surfaceId: "ui", components: spec.components },
      },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "ui", path: "/", value: spec.data },
      },
    ]);
    return instance;
  });
  const surface = processor.model.getSurface("ui");
  return surface ? (
    <A2uiSurface surface={surface} />
  ) : (
    <p role="alert">Unable to render this interface.</p>
  );
}

function Content() {
  const view = useToolContext<"render-ui">();
  if (view.status === "error") return <p role="alert">{view.error.message}</p>;
  if (view.status !== "ready")
    return <p role="status">Designing your interface…</p>;
  return (
    <GeneratedUI
      key={JSON.stringify(view.toolOutput.spec)}
      spec={view.toolOutput.spec}
    />
  );
}

/** Render a completed model-generated A2UI spec inside an ordinary MCP App. */
export default function GenerativeUI() {
  return (
    <ThemeProvider colorScheme>
      <main className="a2ui-canvas">
        <Content />
      </main>
    </ThemeProvider>
  );
}
