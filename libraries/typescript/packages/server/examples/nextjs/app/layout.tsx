import type { ReactNode } from "react";

/** Minimal App Router shell so this standalone route-handler example builds. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
