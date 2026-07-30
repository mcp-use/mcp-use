/**
 * HomeScout SF — a Zillow-style MCP Apps property search.
 *
 * The rendering tool ships the **whole** staged catalog to the iframe through
 * the view-only `_meta` channel, so every follow-up search ("now show SoMa")
 * is served by a view tool that re-filters the open map in place instead of
 * rendering a second view. The model only ever sees the compact match summary
 * in `structuredContent`.
 *
 * Listings are fictional. Map tiles come from CARTO's free OpenStreetMap
 * basemaps; no listing API or paid service is involved.
 */
import { MCPServer } from "mcp-use";
import { z } from "zod";

/** Every staged San Francisco area, in the order the filter rail shows them. */
export const AREA_NAMES = [
  "Pacific Heights",
  "Marina",
  "Russian Hill",
  "Nob Hill",
  "Hayes Valley",
  "SoMa",
  "Mission District",
  "Noe Valley",
  "Potrero Hill",
  "Bernal Heights",
] as const;

const areaSchema = z.enum(AREA_NAMES);
const homeTypeSchema = z.enum([
  "House",
  "Condo",
  "Townhouse",
  "Loft",
  "Multi-family",
]);
const statusSchema = z.enum(["New", "For sale", "Open house", "Pending"]);

/** A staged neighborhood plus the map camera and highlight that frame it. */
const areaMetaSchema = z.object({
  name: areaSchema,
  lat: z.number(),
  lng: z.number(),
  zoom: z.number().describe("Leaflet zoom level that frames the neighborhood"),
  radius: z.number().describe("Highlight-ring radius in meters"),
  tagline: z.string(),
});

/** One staged home, including the real coordinates its map pin sits on. */
const listingSchema = z.object({
  id: z.string(),
  address: z.string(),
  area: areaSchema,
  price: z.number(),
  beds: z.number(),
  baths: z.number(),
  sqft: z.number(),
  homeType: homeTypeSchema,
  status: statusSchema,
  yearBuilt: z.number(),
  daysOnMarket: z.number(),
  hoa: z.number().describe("Monthly HOA dues; 0 when there are none"),
  blurb: z.string(),
  accent: z.string(),
  lat: z.number(),
  lng: z.number(),
});

/** A staged San Francisco neighborhood. */
export type Area = z.infer<typeof areaSchema>;
/** A staged San Francisco home. */
export type Listing = z.infer<typeof listingSchema>;
/** One of the five staged property categories. */
export type HomeType = z.infer<typeof homeTypeSchema>;

/** Map camera and copy for one staged neighborhood. */
export type AreaMeta = z.infer<typeof areaMetaSchema>;

/**
 * Attribution required by the OpenStreetMap and CARTO basemap terms.
 *
 * Rendered by Leaflet's attribution control in the view.
 */
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>';

/** Map camera and copy for each staged neighborhood. */
export const AREAS: readonly AreaMeta[] = [
  {
    name: "Pacific Heights",
    lat: 37.7918,
    lng: -122.4345,
    zoom: 15,
    radius: 700,
    tagline: "Grand Victorians and bay panoramas",
  },
  {
    name: "Marina",
    lat: 37.8025,
    lng: -122.4382,
    zoom: 15,
    radius: 750,
    tagline: "Flat streets, green space, waterfront air",
  },
  {
    name: "Russian Hill",
    lat: 37.8008,
    lng: -122.4194,
    zoom: 15,
    radius: 600,
    tagline: "Steep blocks, cable cars, skyline views",
  },
  {
    name: "Nob Hill",
    lat: 37.7928,
    lng: -122.4139,
    zoom: 15,
    radius: 600,
    tagline: "Classic apartments above the city core",
  },
  {
    name: "Hayes Valley",
    lat: 37.7768,
    lng: -122.4243,
    zoom: 15,
    radius: 600,
    tagline: "Boutiques, patios, and Patricia's Green",
  },
  {
    name: "SoMa",
    lat: 37.7809,
    lng: -122.4014,
    zoom: 14.5,
    radius: 1100,
    tagline: "Lofts, towers, and transit everywhere",
  },
  {
    name: "Mission District",
    lat: 37.7552,
    lng: -122.4183,
    zoom: 14.5,
    radius: 950,
    tagline: "Sunniest blocks in the city",
  },
  {
    name: "Noe Valley",
    lat: 37.7497,
    lng: -122.4318,
    zoom: 15,
    radius: 700,
    tagline: "Family-scale streets below Twin Peaks",
  },
  {
    name: "Potrero Hill",
    lat: 37.7592,
    lng: -122.4014,
    zoom: 15,
    radius: 700,
    tagline: "Sun, skyline, and quiet hillside blocks",
  },
  {
    name: "Bernal Heights",
    lat: 37.7405,
    lng: -122.4172,
    zoom: 15,
    radius: 700,
    tagline: "Cottages ringing a grassy summit",
  },
];

const LISTINGS: readonly Listing[] = [
  // Pacific Heights
  {
    id: "clay-2140",
    address: "2140 Clay Street",
    area: "Pacific Heights",
    price: 3295000,
    beds: 4,
    baths: 3.5,
    sqft: 2810,
    homeType: "House",
    status: "Open house",
    yearBuilt: 1893,
    daysOnMarket: 6,
    hoa: 0,
    blurb: "Restored 1890s millwork, deep bay windows, walled garden terrace.",
    accent: "rose",
    lat: 37.7908,
    lng: -122.4335,
  },
  {
    id: "jackson-1750",
    address: "1750 Jackson Street",
    area: "Pacific Heights",
    price: 2895000,
    beds: 3,
    baths: 2.5,
    sqft: 2240,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 1978,
    daysOnMarket: 21,
    hoa: 890,
    blurb: "Full-floor home with Golden Gate outlooks and a chef's kitchen.",
    accent: "ocean",
    lat: 37.7935,
    lng: -122.4249,
  },
  {
    id: "divisadero-2701",
    address: "2701 Divisadero Street",
    area: "Pacific Heights",
    price: 6450000,
    beds: 5,
    baths: 4.5,
    sqft: 4120,
    homeType: "House",
    status: "For sale",
    yearBuilt: 1908,
    daysOnMarket: 44,
    hoa: 0,
    blurb: "Trophy corner residence with an elevator and three-car parking.",
    accent: "gold",
    lat: 37.7929,
    lng: -122.4418,
  },
  // Marina
  {
    id: "baker-3320",
    address: "3320 Baker Street",
    area: "Marina",
    price: 3150000,
    beds: 3,
    baths: 3,
    sqft: 2050,
    homeType: "House",
    status: "New",
    yearBuilt: 1931,
    daysOnMarket: 2,
    hoa: 0,
    blurb: "Marina-style home a block from the Palace of Fine Arts.",
    accent: "sky",
    lat: 37.8014,
    lng: -122.4455,
  },
  {
    id: "chestnut-2255",
    address: "2255 Chestnut Street",
    area: "Marina",
    price: 1595000,
    beds: 2,
    baths: 2,
    sqft: 1310,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 1996,
    daysOnMarket: 15,
    hoa: 640,
    blurb: "Top-floor corner unit over the Chestnut Street shops.",
    accent: "mint",
    lat: 37.8005,
    lng: -122.4402,
  },
  {
    id: "bay-1230",
    address: "1230 Bay Street",
    area: "Marina",
    price: 2395000,
    beds: 3,
    baths: 2.5,
    sqft: 1780,
    homeType: "Townhouse",
    status: "For sale",
    yearBuilt: 2004,
    daysOnMarket: 33,
    hoa: 420,
    blurb: "Three levels, private roof deck, two-car tandem garage.",
    accent: "terracotta",
    lat: 37.8046,
    lng: -122.4318,
  },
  // Russian Hill
  {
    id: "chestnut-1080",
    address: "1080 Chestnut Street",
    area: "Russian Hill",
    price: 2750000,
    beds: 2,
    baths: 2,
    sqft: 1520,
    homeType: "Condo",
    status: "Open house",
    yearBuilt: 1962,
    daysOnMarket: 9,
    hoa: 1180,
    blurb: "Wall-to-wall glass framing the bay, doorman, valet parking.",
    accent: "ocean",
    lat: 37.8033,
    lng: -122.4226,
  },
  {
    id: "hyde-2200",
    address: "2200 Hyde Street",
    area: "Russian Hill",
    price: 4195000,
    beds: 4,
    baths: 3.5,
    sqft: 2960,
    homeType: "House",
    status: "For sale",
    yearBuilt: 1912,
    daysOnMarket: 27,
    hoa: 0,
    blurb: "Edwardian on the cable-car line with a rebuilt garden level.",
    accent: "plum",
    lat: 37.7994,
    lng: -122.4197,
  },
  {
    id: "green-999",
    address: "999 Green Street",
    area: "Russian Hill",
    price: 1875000,
    beds: 2,
    baths: 2,
    sqft: 1240,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 1971,
    daysOnMarket: 51,
    hoa: 960,
    blurb: "High-floor pied-à-terre with a west-facing sunset balcony.",
    accent: "sunset",
    lat: 37.7973,
    lng: -122.4179,
  },
  // Nob Hill
  {
    id: "leavenworth-1250",
    address: "1250 Leavenworth Street",
    area: "Nob Hill",
    price: 1995000,
    beds: 3,
    baths: 2,
    sqft: 1840,
    homeType: "House",
    status: "For sale",
    yearBuilt: 1906,
    daysOnMarket: 12,
    hoa: 0,
    blurb: "Graceful corner Edwardian two blocks from Huntington Park.",
    accent: "gold",
    lat: 37.7938,
    lng: -122.4163,
  },
  {
    id: "california-930",
    address: "930 California Street",
    area: "Nob Hill",
    price: 1549000,
    beds: 2,
    baths: 2,
    sqft: 1320,
    homeType: "Condo",
    status: "New",
    yearBuilt: 1984,
    daysOnMarket: 3,
    hoa: 820,
    blurb: "Sunlit retreat on the cable-car line with skyline views.",
    accent: "sage",
    lat: 37.7921,
    lng: -122.4113,
  },
  {
    id: "sacramento-1170",
    address: "1170 Sacramento Street",
    area: "Nob Hill",
    price: 3650000,
    beds: 3,
    baths: 3,
    sqft: 2410,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 1926,
    daysOnMarket: 38,
    hoa: 1640,
    blurb: "Full-service pre-war cooperative with a formal entry gallery.",
    accent: "midnight",
    lat: 37.7929,
    lng: -122.4131,
  },
  // Hayes Valley
  {
    id: "gough-488",
    address: "488 Gough Street",
    area: "Hayes Valley",
    price: 1795000,
    beds: 3,
    baths: 2,
    sqft: 1605,
    homeType: "Townhouse",
    status: "Open house",
    yearBuilt: 2016,
    daysOnMarket: 5,
    hoa: 385,
    blurb: "Design-forward home with a private courtyard off the kitchen.",
    accent: "terracotta",
    lat: 37.7789,
    lng: -122.4229,
  },
  {
    id: "linden-52",
    address: "52 Linden Street",
    area: "Hayes Valley",
    price: 1195000,
    beds: 2,
    baths: 1.5,
    sqft: 1120,
    homeType: "Loft",
    status: "For sale",
    yearBuilt: 2001,
    daysOnMarket: 24,
    hoa: 540,
    blurb: "Two-story loft on a beloved pedestrian alley.",
    accent: "plum",
    lat: 37.7761,
    lng: -122.4266,
  },
  {
    id: "hayes-301",
    address: "301 Hayes Street",
    area: "Hayes Valley",
    price: 1425000,
    beds: 2,
    baths: 2,
    sqft: 1190,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 2008,
    daysOnMarket: 17,
    hoa: 610,
    blurb: "Corner unit above the shops with an in-unit laundry room.",
    accent: "sage",
    lat: 37.7766,
    lng: -122.4237,
  },
  // SoMa
  {
    id: "brannan-855",
    address: "855 Brannan Street",
    area: "SoMa",
    price: 1249000,
    beds: 2,
    baths: 2,
    sqft: 1185,
    homeType: "Loft",
    status: "Open house",
    yearBuilt: 2014,
    daysOnMarket: 7,
    hoa: 780,
    blurb: "Airy industrial loft with walls of glass and a staffed lobby.",
    accent: "steel",
    lat: 37.7715,
    lng: -122.4046,
  },
  {
    id: "fremont-301",
    address: "301 Fremont Street",
    area: "SoMa",
    price: 3495000,
    beds: 3,
    baths: 3,
    sqft: 2260,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 2007,
    daysOnMarket: 41,
    hoa: 1980,
    blurb: "High-floor panorama with hotel-caliber amenities.",
    accent: "midnight",
    lat: 37.7885,
    lng: -122.3933,
  },
  {
    id: "newmontgomery-199",
    address: "199 New Montgomery Street",
    area: "SoMa",
    price: 995000,
    beds: 1,
    baths: 1,
    sqft: 860,
    homeType: "Loft",
    status: "New",
    yearBuilt: 1998,
    daysOnMarket: 1,
    hoa: 690,
    blurb: "Brick-and-timber conversion steps from Yerba Buena.",
    accent: "sunset",
    lat: 37.7866,
    lng: -122.3996,
  },
  {
    id: "mission-1160",
    address: "1160 Mission Street",
    area: "SoMa",
    price: 875000,
    beds: 1,
    baths: 1,
    sqft: 720,
    homeType: "Condo",
    status: "Pending",
    yearBuilt: 2006,
    daysOnMarket: 62,
    hoa: 720,
    blurb: "Entry-level city home with a pool, gym, and roof lounge.",
    accent: "steel",
    lat: 37.7784,
    lng: -122.4113,
  },
  // Mission District
  {
    id: "valencia-1188",
    address: "1188 Valencia Street",
    area: "Mission District",
    price: 1395000,
    beds: 2,
    baths: 2,
    sqft: 1280,
    homeType: "Condo",
    status: "Open house",
    yearBuilt: 2013,
    daysOnMarket: 4,
    hoa: 495,
    blurb: "Warm modern interiors, shared roof deck, 98 walk score.",
    accent: "sunset",
    lat: 37.7531,
    lng: -122.4208,
  },
  {
    id: "dolores-620",
    address: "620 Dolores Street",
    area: "Mission District",
    price: 2249000,
    beds: 3,
    baths: 2.5,
    sqft: 1930,
    homeType: "House",
    status: "For sale",
    yearBuilt: 1901,
    daysOnMarket: 19,
    hoa: 0,
    blurb: "Park-side Victorian with soaring ceilings and original detail.",
    accent: "sky",
    lat: 37.7595,
    lng: -122.4262,
  },
  {
    id: "twentyfourth-3055",
    address: "3055 24th Street",
    area: "Mission District",
    price: 1850000,
    beds: 4,
    baths: 3,
    sqft: 2400,
    homeType: "Multi-family",
    status: "For sale",
    yearBuilt: 1922,
    daysOnMarket: 29,
    hoa: 0,
    blurb: "Two-unit building; live in one, rent the other.",
    accent: "rose",
    lat: 37.7525,
    lng: -122.4118,
  },
  {
    id: "guerrero-1425",
    address: "1425 Guerrero Street",
    area: "Mission District",
    price: 1150000,
    beds: 2,
    baths: 1,
    sqft: 960,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 1907,
    daysOnMarket: 48,
    hoa: 380,
    blurb: "Garden-level flat with a rebuilt kitchen and deeded storage.",
    accent: "mint",
    lat: 37.7497,
    lng: -122.4227,
  },
  // Noe Valley
  {
    id: "twentyfourth-410",
    address: "410 24th Street",
    area: "Noe Valley",
    price: 2595000,
    beds: 4,
    baths: 3,
    sqft: 2350,
    homeType: "House",
    status: "Open house",
    yearBuilt: 2019,
    daysOnMarket: 8,
    hoa: 0,
    blurb: "Indoor-outdoor living with Twin Peaks views from the top floor.",
    accent: "mint",
    lat: 37.7517,
    lng: -122.4312,
  },
  {
    id: "diamond-815",
    address: "815 Diamond Street",
    area: "Noe Valley",
    price: 1695000,
    beds: 2,
    baths: 2,
    sqft: 1410,
    homeType: "House",
    status: "For sale",
    yearBuilt: 1939,
    daysOnMarket: 22,
    hoa: 0,
    blurb: "Charming detached cottage steps from the village.",
    accent: "lavender",
    lat: 37.7489,
    lng: -122.4372,
  },
  {
    id: "church-1275",
    address: "1275 Church Street",
    area: "Noe Valley",
    price: 1295000,
    beds: 2,
    baths: 1,
    sqft: 1050,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 1988,
    daysOnMarket: 35,
    hoa: 450,
    blurb: "Quiet rear-facing flat on the J-Church line.",
    accent: "sage",
    lat: 37.7481,
    lng: -122.4274,
  },
  // Potrero Hill
  {
    id: "kansas-1220",
    address: "1220 Kansas Street",
    area: "Potrero Hill",
    price: 2195000,
    beds: 3,
    baths: 2.5,
    sqft: 1890,
    homeType: "House",
    status: "New",
    yearBuilt: 1994,
    daysOnMarket: 2,
    hoa: 0,
    blurb: "South-slope home with downtown views and a level yard.",
    accent: "gold",
    lat: 37.7556,
    lng: -122.4032,
  },
  {
    id: "rhodeisland-640",
    address: "640 Rhode Island Street",
    area: "Potrero Hill",
    price: 1595000,
    beds: 3,
    baths: 2,
    sqft: 1520,
    homeType: "Townhouse",
    status: "For sale",
    yearBuilt: 2009,
    daysOnMarket: 26,
    hoa: 395,
    blurb: "Sunny end unit with a garage and a private deck.",
    accent: "terracotta",
    lat: 37.7627,
    lng: -122.4042,
  },
  {
    id: "connecticut-300",
    address: "300 Connecticut Street",
    area: "Potrero Hill",
    price: 1150000,
    beds: 2,
    baths: 1,
    sqft: 980,
    homeType: "Condo",
    status: "For sale",
    yearBuilt: 1990,
    daysOnMarket: 44,
    hoa: 425,
    blurb: "Two-unit building on the neighborhood's main street.",
    accent: "sky",
    lat: 37.7604,
    lng: -122.3987,
  },
  // Bernal Heights
  {
    id: "bocana-55",
    address: "55 Bocana Street",
    area: "Bernal Heights",
    price: 1595000,
    beds: 3,
    baths: 2,
    sqft: 1480,
    homeType: "House",
    status: "Open house",
    yearBuilt: 1925,
    daysOnMarket: 6,
    hoa: 0,
    blurb: "North-slope home with a deep garden and a rebuilt kitchen.",
    accent: "rose",
    lat: 37.7423,
    lng: -122.4167,
  },
  {
    id: "cortland-720",
    address: "720 Cortland Avenue",
    area: "Bernal Heights",
    price: 1795000,
    beds: 4,
    baths: 3,
    sqft: 2100,
    homeType: "Multi-family",
    status: "For sale",
    yearBuilt: 1918,
    daysOnMarket: 31,
    hoa: 0,
    blurb: "Two flats over a commercial storefront on Cortland.",
    accent: "plum",
    lat: 37.7387,
    lng: -122.4163,
  },
  {
    id: "elsie-145",
    address: "145 Elsie Street",
    area: "Bernal Heights",
    price: 1395000,
    beds: 2,
    baths: 1,
    sqft: 1100,
    homeType: "House",
    status: "For sale",
    yearBuilt: 1908,
    daysOnMarket: 40,
    hoa: 0,
    blurb: "Storybook cottage on one of the city's prettiest blocks.",
    accent: "lavender",
    lat: 37.7417,
    lng: -122.4196,
  },
];

/** Extra spellings the model or a user might type for a staged area. */
const AREA_ALIASES: Partial<Record<Area, readonly string[]>> = {
  "Mission District": ["mission", "themission", "innermission"],
  "Pacific Heights": ["pacheights", "pacifichts", "pachts"],
  SoMa: ["southofmarket", "soma", "rincon", "eastcut"],
  Marina: ["marinadistrict", "cowhollow"],
  "Noe Valley": ["noe"],
  "Nob Hill": ["nobhill", "lowernobhill"],
  "Potrero Hill": ["potrero", "dogpatch"],
  "Bernal Heights": ["bernal"],
  "Hayes Valley": ["hayes", "civiccenter"],
  "Russian Hill": ["russianhill", "northbeach"],
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Resolve free-text like "the mission" to a staged area, or `null` for all of SF. */
function resolveArea(query: string): Area | null {
  const normalized = slug(query);
  if (normalized === "" || normalized.includes("sanfrancisco")) {
    return null;
  }
  return (
    AREA_NAMES.find(
      (name) =>
        normalized.includes(slug(name)) ||
        (AREA_ALIASES[name]?.some((alias) => normalized.includes(alias)) ??
          false)
    ) ?? null
  );
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1] ?? sorted[mid] ?? 0;
  const high = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? Math.round((low + high) / 2) : high;
};

const server = new MCPServer({
  name: "homescout-sf",
  version: "2.0.0",
  title: "HomeScout SF",
  legacy: "stateless",
  description:
    "Search a staged catalog of San Francisco homes on a live OpenStreetMap-backed map.",
  basePath: "/mcp",
});

const oneSentenceResponse =
  "After calling this tool, respond to the user with exactly one sentence.";

export const searchHomes = server.tool(
  {
    name: "search-homes",
    title: "Search San Francisco homes",
    description: [
      "Open the interactive HomeScout map for San Francisco homes. Accepts a natural-language location such as 'San Francisco', 'Nob Hill', 'the Mission', or 'South of Market', plus optional price/bed/bath/home-type filters.",
      "Call this **once** to put the map on screen. After that the view registers its own tools — most importantly `search-in-view` — and every follow-up search ('search homes in SoMa', 'now the Mission', 'only under $2M') must go through those view tools so the open map updates in place. Do not call `search-homes` again while the view is open; that would render a second view.",
      oneSentenceResponse,
    ].join("\n\n"),
    inputSchema: z.object({
      location: z
        .string()
        .optional()
        .describe(
          "'San Francisco' or a neighborhood name; unrecognized areas fall back to all of San Francisco"
        ),
      maxPrice: z.number().positive().optional(),
      minPrice: z.number().positive().optional(),
      minBeds: z.number().int().min(0).optional(),
      minBaths: z.number().min(0).optional(),
      homeType: homeTypeSchema.optional(),
    }),
    outputSchema: z.object({
      query: z.string(),
      area: areaSchema.nullable().describe("null means all of San Francisco"),
      matchedIds: z
        .array(z.string())
        .describe(
          "Listing IDs matching this search; the view tools accept them"
        ),
      medianPrice: z.number().nullable(),
      // The whole catalog ships to the iframe on the first call so
      // `search-in-view` can re-filter any neighborhood locally instead of
      // rendering a second view.
      catalog: z.object({
        listings: z.array(listingSchema),
        areas: z.array(areaMetaSchema),
        attribution: z.string(),
      }),
    }),
    view: {
      name: "property-search",
      description:
        "Zillow-style San Francisco home search: OpenStreetMap basemap, price-bubble pins, and assistant-driven in-place search",
      prefersBorder: false,
      csp: {
        // CARTO's free OpenStreetMap raster basemaps.
        resourceDomains: ["https://basemaps.cartocdn.com"],
        connectDomains: ["https://basemaps.cartocdn.com"],
      },
    },
  },
  async ({
    location = "San Francisco",
    maxPrice,
    minPrice,
    minBeds = 0,
    minBaths = 0,
    homeType,
  }) => {
    const area = resolveArea(location);
    const matched = LISTINGS.filter(
      (listing) =>
        (area === null || listing.area === area) &&
        (maxPrice === undefined || listing.price <= maxPrice) &&
        (minPrice === undefined || listing.price >= minPrice) &&
        listing.beds >= minBeds &&
        listing.baths >= minBaths &&
        (homeType === undefined || listing.homeType === homeType)
    );

    return {
      content: [
        {
          type: "text",
          text: `HomeScout is open with ${matched.length} staged home${
            matched.length === 1 ? "" : "s"
          } in ${area ?? "San Francisco"}; all ${
            LISTINGS.length
          } catalog homes are loaded in the view, so refine from here with the view tools (\`search-in-view\`, \`remove-listings\`, \`select-listing\`, \`fit-visible-results\`, \`zoom-map\`, \`pan-map\`) rather than calling \`search-homes\` again.`,
        },
      ],
      structuredContent: {
        query: location,
        area,
        matchedIds: matched.map((listing) => listing.id),
        medianPrice: median(matched.map((listing) => listing.price)),
        catalog: {
          listings: [...LISTINGS],
          areas: [...AREAS],
          attribution: ATTRIBUTION,
        },
      },
    };
  }
);

export const getListingDetails = server.tool(
  {
    name: "get-listing-details",
    title: "Get staged listing details",
    description: `Load extra staged facts for one HomeScout listing when a card or map pin is selected. ${oneSentenceResponse}`,
    visibility: "app",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({
      id: z.string(),
      address: z.string(),
      note: z.string(),
      openHouse: z.string(),
      hoa: z.string(),
      pricePerSqft: z.number(),
      estimatedPayment: z.number(),
      walkScore: z.number(),
      listedBy: z.string(),
    }),
  },
  async ({ id }) => {
    const listing = LISTINGS.find((candidate) => candidate.id === id);
    if (listing === undefined) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown staged listing: ${id}` }],
      };
    }
    // Staged 30-year amortization at 6.5% on 80% of the list price.
    const principal = listing.price * 0.8;
    const monthlyRate = 0.065 / 12;
    const payments = 360;
    const details = {
      id,
      address: listing.address,
      note: `${listing.blurb} Staged for this demo; not a real listing.`,
      openHouse:
        listing.status === "Open house"
          ? "Saturday · 1–3 PM"
          : listing.status === "Pending"
            ? "Offer accepted — no showings"
            : "By appointment",
      hoa: listing.hoa === 0 ? "None" : `$${listing.hoa}/mo`,
      pricePerSqft: Math.round(listing.price / listing.sqft),
      estimatedPayment: Math.round(
        (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -payments)) +
          listing.hoa
      ),
      walkScore: 72 + ((listing.address.length * 7) % 27),
      listedBy: "HomeScout Staged Listings",
    };
    return {
      content: [
        {
          type: "text",
          text: `Loaded staged listing details for ${listing.address}.`,
        },
      ],
      structuredContent: details,
    };
  }
);

export default server;
