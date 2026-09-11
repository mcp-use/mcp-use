import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TanStack Start + mcp-use" },
    ],
  }),
  component: function Root() {
    return (
      <html lang="en">
        <head>
          <HeadContent />
        </head>
        <body style={{ fontFamily: "system-ui", margin: 0 }}>
          <Outlet />
          <Scripts />
        </body>
      </html>
    );
  },
});
