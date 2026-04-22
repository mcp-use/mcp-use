import type { ReactNode } from "react";

export function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: 16,
        margin: "16px 0",
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
