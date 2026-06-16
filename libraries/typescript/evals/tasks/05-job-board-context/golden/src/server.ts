import { MCPServer, object, text, widget } from "mcp-use/server";
import { z } from "zod";

interface JobListing {
  id: string;
  title: string;
  company: string;
  requirements: string[];
}

const listings: JobListing[] = [
  {
    id: "frontend-platform",
    title: "Frontend Platform Engineer",
    company: "Northstar Labs",
    requirements: [
      "React",
      "TypeScript",
      "accessibility",
      "design systems",
      "testing",
    ],
  },
  {
    id: "data-product-analyst",
    title: "Data Product Analyst",
    company: "Beacon Health",
    requirements: [
      "SQL",
      "Python",
      "dashboards",
      "experimentation",
      "stakeholder communication",
    ],
  },
  {
    id: "developer-advocate",
    title: "Developer Advocate",
    company: "Orbit API",
    requirements: [
      "TypeScript",
      "technical writing",
      "demos",
      "community",
      "public speaking",
    ],
  },
];

let currentListingId: string | null = null;

const server = new MCPServer({
  name: "job-board-context-server",
  version: "1.0.0",
  description:
    "Golden solution for a job board that remembers the user's liked listing",
});

server.tool(
  {
    name: "browse_jobs",
    description: "Browse available job listings, optionally filtered by search",
    schema: z.object({
      search: z.string().optional().describe("Optional search text"),
    }),
    widget: {
      name: "job-board",
      invoking: "Loading job board...",
      invoked: "Job board ready",
    },
  },
  async ({ search }) => {
    const matches = filterListings(search);
    return widget({
      props: { listings: matches, currentListingId },
      message: formatListings(matches),
    });
  }
);

server.tool(
  {
    name: "like_listing",
    description: "Mark a listing as the user's current liked listing",
    schema: z.object({
      listingId: z.string().describe("The listing id to like"),
    }),
  },
  async ({ listingId }) => {
    const listing = findListing(listingId);
    if (!listing) return text(`Listing "${listingId}" not found`);
    currentListingId = listing.id;
    return text(`Liked ${listing.title} at ${listing.company}`);
  }
);

server.tool(
  {
    name: "am_i_qualified",
    description:
      "Assess the candidate against the most recently liked listing; no listing id is required",
    schema: z.object({
      candidateProfile: z
        .string()
        .describe("Candidate skills, experience, or resume summary"),
    }),
  },
  async ({ candidateProfile }) => {
    if (!currentListingId) {
      return text("no current listing: like a listing before asking.");
    }

    const listing = findListing(currentListingId);
    if (!listing) {
      currentListingId = null;
      return text("no current listing: the liked listing is no longer available.");
    }

    const { met, gaps } = compareProfile(candidateProfile, listing);
    const verdict =
      met.length >= Math.ceil(listing.requirements.length * 0.6)
        ? "likely qualified"
        : "not yet qualified";

    return object({
      listingId: listing.id,
      title: listing.title,
      company: listing.company,
      verdict,
      matchedRequirements: met,
      gaps,
      summary: `${verdict} for ${listing.title} at ${listing.company}`,
    });
  }
);

function filterListings(search?: string): JobListing[] {
  const query = search?.trim().toLowerCase();
  if (!query) return listings;
  return listings.filter((listing) =>
    [
      listing.id,
      listing.title,
      listing.company,
      ...listing.requirements,
    ].some((value) => value.toLowerCase().includes(query))
  );
}

function findListing(id: string): JobListing | undefined {
  return listings.find((listing) => listing.id === id);
}

function formatListings(matches: JobListing[]): string {
  if (matches.length === 0) return "No jobs matched the search.";
  return matches
    .map(
      (listing) =>
        `${listing.id}: ${listing.title} at ${listing.company} — ${listing.requirements.join(", ")}`
    )
    .join("\n");
}

function compareProfile(profile: string, listing: JobListing) {
  const normalized = profile.toLowerCase();
  const met = listing.requirements.filter((requirement) =>
    normalized.includes(requirement.toLowerCase())
  );
  const gaps = listing.requirements.filter(
    (requirement) => !met.includes(requirement)
  );
  return { met, gaps };
}

// listen() resolves the port from PORT env (default 3000)
await server.listen();
