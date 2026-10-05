import { useToolContext, type ViewConfig } from "mcp-use/react";
import { Shop } from "./shop.js";
import "./view.css";

/** Tool cards prefer inline presentation and can expand when supported. */
export const viewConfig = {
  displayModes: ["inline", "fullscreen"],
  preferredDisplayMode: "inline",
} satisfies ViewConfig;

/** Mount navigation after tool data is ready; later snapshots do not reset it. */
export default function BookshopView() {
  const view = useToolContext<"open_bookshop">();
  if (view.status === "pending")
    return (
      <main className="bookshop empty" role="status">
        Opening Little Bookshop…
      </main>
    );
  if (view.status === "error")
    return (
      <main className="bookshop empty" role="alert">
        Could not open bookshop: {view.error.message}
      </main>
    );
  return <Shop initial={view.toolOutput} />;
}
