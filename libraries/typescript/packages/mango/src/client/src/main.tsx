import React from "react";
import ReactDOM from "react-dom/client";
import { McpUseProvider } from "mcp-use/react";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <McpUseProvider>
      <App />
    </McpUseProvider>
  </React.StrictMode>
);
