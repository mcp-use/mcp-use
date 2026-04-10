import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Wait for DOM to be ready before rendering
const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
} else {
  console.error("[inspector] Root element not found");
}
