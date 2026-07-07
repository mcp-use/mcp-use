import type { ViewMetadata } from "@mcp-use/server/react";

export const metadata: ViewMetadata = {
  description: "Unbound preview view",
};

export default function OrphanView() {
  return <div data-testid="orphan">orphan</div>;
}
