import {
  McpUseProvider,
  ModelContext,
  modelContext,
  useCallTool,
  useWidget,
  type WidgetMetadata,
} from "mcp-use/react";
import React, { useMemo, useState } from "react";
import { z } from "zod";

const listingSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  requirements: z.array(z.string()),
});

const propSchema = z.object({
  listings: z.array(listingSchema),
  currentListingId: z.string().nullable(),
});

export const widgetMetadata: WidgetMetadata = {
  description:
    "Browsable job board that publishes the selected listing as model context",
  props: propSchema,
  exposeAsTool: false,
  metadata: {
    autoResize: true,
    prefersBorder: true,
    widgetDescription: "Interactive job board with AI-aware listing context",
  },
};

type Listing = z.infer<typeof listingSchema>;
type Props = z.infer<typeof propSchema>;

export default function JobBoard() {
  const { props, isPending, theme } = useWidget<Props>();
  const { callTool, isPending: isLiking } =
    useCallTool<{ listingId: string }>("like_listing");
  const [selectedId, setSelectedId] = useState<string | null>(
    props.currentListingId ?? null
  );
  const isDark = theme === "dark";

  const listings = props.listings ?? [];
  const selected = useMemo(
    () => listings.find((listing) => listing.id === selectedId) ?? null,
    [listings, selectedId]
  );

  function likeListing(listing: Listing) {
    setSelectedId(listing.id);
    modelContext.set(
      "liked-job-listing",
      `Liked listing: ${listing.id} — ${listing.title} at ${listing.company}. Requirements: ${listing.requirements.join(", ")}`
    );
    callTool({ listingId: listing.id });
  }

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 20 }}>Loading jobs...</div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <ModelContext content="User is browsing job listings">
        {selected && (
          <ModelContext
            content={`Selected listing: ${selected.id} — ${selected.title} at ${selected.company}. Requirements: ${selected.requirements.join(", ")}`}
          />
        )}
        <div
          style={{
            display: "grid",
            gap: 12,
            padding: 16,
            color: isDark ? "#f4f4f5" : "#18181b",
            background: isDark ? "#09090b" : "#ffffff",
          }}
        >
          <header>
            <h2 style={{ margin: 0, fontSize: 18 }}>Job Board</h2>
            <p style={{ margin: "4px 0 0", color: isDark ? "#a1a1aa" : "#52525b" }}>
              Like a role, then ask whether you are qualified for this.
            </p>
          </header>
          <div style={{ display: "grid", gap: 8 }}>
            {listings.map((listing) => {
              const active = listing.id === selectedId;
              return (
                <button
                  key={listing.id}
                  onClick={() => likeListing(listing)}
                  disabled={isLiking}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    borderRadius: 8,
                    border: active ? "2px solid #2563eb" : "1px solid #d4d4d8",
                    background: active
                      ? isDark
                        ? "#172554"
                        : "#eff6ff"
                      : isDark
                        ? "#18181b"
                        : "#fafafa",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <strong>{listing.title}</strong>
                  <div>{listing.company}</div>
                  <small>{listing.requirements.join(" / ")}</small>
                </button>
              );
            })}
          </div>
        </div>
      </ModelContext>
    </McpUseProvider>
  );
}
