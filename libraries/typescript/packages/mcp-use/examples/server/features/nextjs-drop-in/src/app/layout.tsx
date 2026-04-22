import type { ReactNode } from "react";

export const metadata = {
  title: "Next.js drop-in MCP example",
  description: "Next.js app with a drop-in MCP server under src/mcp/",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
