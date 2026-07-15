const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";
const UI_MIME_TYPE = "text/html;profile=mcp-app";

const CATALOG_IDS = new Set([
  "tools",
  "resources",
  "prompts",
  "logging",
  "completions",
  "tasks",
  "experimental",
  "extensions",
]);

type CapabilityFeatureDef = { path: string; label: string };

type CapabilityCatalogEntry = {
  id: string;
  label: string;
  features?: CapabilityFeatureDef[];
};

const SERVER_CAPABILITY_CATALOG: CapabilityCatalogEntry[] = [
  {
    id: "tools",
    label: "Tools",
    features: [{ path: "listChanged", label: "listChanged" }],
  },
  {
    id: "resources",
    label: "Resources",
    features: [
      { path: "subscribe", label: "subscribe" },
      { path: "listChanged", label: "listChanged" },
    ],
  },
  {
    id: "prompts",
    label: "Prompts",
    features: [{ path: "listChanged", label: "listChanged" }],
  },
  { id: "logging", label: "Logging" },
  { id: "completions", label: "Completions" },
  {
    id: "tasks",
    label: "Tasks",
    features: [
      { path: "list", label: "list" },
      { path: "cancel", label: "cancel" },
      { path: "requests.tools.call", label: "requests.tools.call" },
    ],
  },
  { id: "experimental", label: "Experimental" },
  { id: "extensions", label: "Extensions" },
];

export type CapabilityRow = {
  id: string;
  label: string;
  supported: boolean;
  features: { id: string; label: string }[];
  detail?: string;
};

export type ServerCapabilitySignals = {
  tools?: Array<{ _meta?: Record<string, unknown> }>;
  resources?: Array<{ mimeType?: string }>;
  resourceTemplates?: Array<{ mimeType?: string }>;
};

function hasViewToolMeta(meta?: Record<string, unknown>): boolean {
  const uri = meta?.ui;
  return (
    typeof uri === "object" &&
    uri !== null &&
    "resourceUri" in uri &&
    typeof (uri as { resourceUri?: unknown }).resourceUri === "string"
  );
}

function hasViewMimeType(mimeType?: string): boolean {
  return mimeType === UI_MIME_TYPE;
}

function inferMcpAppsExtension(
  signals?: ServerCapabilitySignals
): Record<string, unknown> | undefined {
  if (!signals) return undefined;

  const hasViewTool = (signals.tools ?? []).some((tool) =>
    hasViewToolMeta(tool._meta)
  );
  const hasViewResource = (signals.resources ?? []).some((resource) =>
    hasViewMimeType(resource.mimeType)
  );
  const hasViewTemplate = (signals.resourceTemplates ?? []).some((template) =>
    hasViewMimeType(template.mimeType)
  );

  if (!hasViewTool && !hasViewResource && !hasViewTemplate) {
    return undefined;
  }

  return {
    [UI_EXTENSION_ID]: { mimeTypes: [UI_MIME_TYPE] },
  };
}

function getNested(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function mergeExtensions(
  capabilities: Record<string, unknown>,
  extensions?: Record<string, unknown>
): Record<string, unknown> {
  const fromCaps = capabilities.extensions;
  const capExt =
    typeof fromCaps === "object" && fromCaps !== null
      ? (fromCaps as Record<string, unknown>)
      : {};
  return { ...capExt, ...(extensions ?? {}) };
}

function extensionLabel(key: string): string {
  return key === UI_EXTENSION_ID ? "MCP Apps" : key;
}

function mcpAppsDetail(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const mimeTypes = (value as { mimeTypes?: unknown }).mimeTypes;
  if (!Array.isArray(mimeTypes) || mimeTypes.length === 0) return undefined;
  return mimeTypes.map(String).join(", ");
}

function catalogRow(
  entry: CapabilityCatalogEntry,
  capabilities: Record<string, unknown>,
  mergedExtensions: Record<string, unknown>
): CapabilityRow {
  if (entry.id === "extensions") {
    const hasCapKey = isPresent(capabilities.extensions);
    const hasMerged = Object.keys(mergedExtensions).length > 0;
    const supported = hasCapKey || hasMerged;
    const features = Object.keys(mergedExtensions).map((key) => ({
      id: key,
      label: extensionLabel(key),
    }));
    const detail = mcpAppsDetail(mergedExtensions[UI_EXTENSION_ID]);
    return {
      id: entry.id,
      label: entry.label,
      supported,
      features,
      detail,
    };
  }

  if (entry.id === "experimental") {
    const value = capabilities.experimental;
    const supported = isPresent(value);
    const features =
      supported && typeof value === "object" && value !== null
        ? Object.keys(value as Record<string, unknown>).map((key) => ({
            id: key,
            label: key,
          }))
        : [];
    return {
      id: entry.id,
      label: entry.label,
      supported,
      features,
    };
  }

  const value = capabilities[entry.id];
  const supported = isPresent(value);
  const features =
    supported && entry.features
      ? entry.features
          .filter((feature) => isPresent(getNested(value, feature.path)))
          .map((feature) => ({ id: feature.path, label: feature.label }))
      : [];

  return {
    id: entry.id,
    label: entry.label,
    supported,
    features,
  };
}

function unknownRows(capabilities: Record<string, unknown>): CapabilityRow[] {
  return Object.keys(capabilities)
    .filter((key) => !CATALOG_IDS.has(key))
    .map((key) => {
      const value = capabilities[key];
      const features =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? Object.keys(value as Record<string, unknown>).map((nested) => ({
              id: `${key}.${nested}`,
              label: nested,
            }))
          : [];
      return {
        id: key,
        label: key,
        supported: true,
        features,
      };
    });
}

/** Build formatted capability rows from wire initialize capabilities. */
export function buildServerCapabilityRows(
  capabilities: Record<string, unknown>,
  extensions?: Record<string, unknown>,
  signals?: ServerCapabilitySignals
): CapabilityRow[] {
  let mergedExtensions = mergeExtensions(capabilities, extensions);
  const inferred = inferMcpAppsExtension(signals);
  if (inferred && mergedExtensions[UI_EXTENSION_ID] === undefined) {
    mergedExtensions = { ...mergedExtensions, ...inferred };
  }

  const rows = SERVER_CAPABILITY_CATALOG.map((entry) =>
    catalogRow(entry, capabilities, mergedExtensions)
  );
  return [...rows, ...unknownRows(capabilities)];
}
