import "server-only";
import { headers } from "next/headers";

export async function getGreeting(name: string): Promise<string> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "unknown";
    return `Hello, ${name}! (ua: ${ua})`;
  } catch {
    return `Hello, ${name}! (no request context)`;
  }
}

export const sampleItems = [
  { id: 1, label: "Alpha" },
  { id: 2, label: "Beta" },
  { id: 3, label: "Gamma" },
];
