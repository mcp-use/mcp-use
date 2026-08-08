import { getRequestListener } from "@hono/node-server";
import type { Plugin } from "vite";
import { createDevApiApp } from "./create-dev-api-app.js";

function isDevApiPath(url: string): boolean {
  return (
    url.startsWith("/inspector/api/") ||
    url === "/inspector/health" ||
    url.startsWith("/inspector/health?")
  );
}

/** Mount inspector proxy + OAuth BFF on the Vite dev server (single port). */
export function inspectorDevApiPlugin(): Plugin {
  return {
    name: "inspector-dev-api",
    configureServer(server) {
      const listener = getRequestListener(createDevApiApp().fetch);
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!isDevApiPath(url)) return next();
        return listener(req, res);
      });
    },
  };
}
