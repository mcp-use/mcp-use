/**
 * Eval suite files: one YAML (or JSON) document per suite.
 *
 * Flow steps use the same shape the dashboard and API store (`kind: user`,
 * `tool_call`, `assistant_text`). `clients` has one key per kind of client,
 * since each takes different options: `inspector` (models), `runtimes`
 * (harness, model, provider) and the `chatgpt` / `claude` web apps (their
 * default model, or chosen models). The CLI parses and validates a file locally
 * and maps it onto Cloud's suite fields, like `alerts`. A file is a suite's
 * whole definition: writing it over an existing suite resets every omitted
 * field to its default.
 */
import { readFile } from "node:fs/promises";
// Bundled validation used by the CLI.
// eslint-disable-next-line import/no-extraneous-dependencies
import { z } from "zod";
import { parseDocument } from "../../skills/vendor/yaml-2.8.3.min.js";
import { UsageError } from "../../core/errors.js";
import { record } from "../../core/format.js";

/** Largest accepted suite file. */
const MAX_BYTES = 256 * 1024;
const DEFAULT_THRESHOLD = 0.7;
/** Agent harnesses a `clients.runtimes` entry can name. */
export const HARNESSES = ["pi", "codex", "claude-code", "cursor"] as const;
const PROVIDERS = ["openrouter", "openai", "anthropic", "cursor"] as const;
const WEB_CLIENTS = ["chatgpt", "claude"] as const;
/** Cloud's limits: runtime executions per suite, models per web app. */
const MAX_RUNTIMES = 12;
const MAX_WEB_MODELS = 10;

const modelId = z.string().trim().min(1).max(200);
const toolName = z.string().trim().min(1).max(255);

/** A flow step, in the shape the dashboard and API store. */
const step = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("user"),
    content: z.string().trim().min(1).max(10_000),
  }),
  z.strictObject({
    kind: z.literal("tool_call"),
    name: toolName,
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({
    kind: z.literal("assistant_text"),
    note: z.string().max(10_000).optional(),
  }),
]);

const uniqueModels = (max: number) =>
  z
    .array(modelId)
    .min(1)
    .max(max)
    .refine(
      (models) => new Set(models).size === models.length,
      "Model IDs must be unique."
    );

const runtime = z.strictObject({
  harness: z.enum(HARNESSES),
  model: modelId,
  provider: z.enum(PROVIDERS).optional(),
});

/** A web app: `true` runs its default model, `{ models }` runs each model. */
const webApp = z
  .union([
    z.boolean(),
    z.strictObject({ models: uniqueModels(MAX_WEB_MODELS) }),
  ])
  .default(false);

const clients = z
  .strictObject({
    inspector: z
      .strictObject({ models: uniqueModels(Number.MAX_SAFE_INTEGER) })
      .optional(),
    runtimes: z
      .array(runtime)
      .max(MAX_RUNTIMES)
      .default([])
      .refine(
        (items) =>
          new Set(items.map((item) => JSON.stringify(item))).size ===
          items.length,
        "Runtimes must be unique."
      ),
    chatgpt: webApp,
    claude: webApp,
  })
  .refine(
    (value) =>
      value.inspector !== undefined ||
      value.runtimes.length > 0 ||
      value.chatgpt !== false ||
      value.claude !== false,
    "Select at least one client."
  );

const fileSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  flow: z
    .array(step)
    .min(1)
    .refine(
      (steps) => steps.some((item) => item.kind === "user"),
      "Add at least one user step."
    ),
  rubric: z.string().trim().min(1).max(10_000).optional(),
  threshold: z.number().min(0).max(1).default(DEFAULT_THRESHOLD),
  clients: clients.optional(),
  disallowedTools: z.array(toolName).default([]),
  enabled: z.boolean().default(true),
});

/** A validated suite file. */
export type EvalSuiteFile = z.output<typeof fileSchema>;
type Step = z.output<typeof step>;

/** Read and validate a YAML or JSON suite file. JSON is valid YAML. */
export async function readEvalSuiteFile(path: string): Promise<EvalSuiteFile> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new UsageError(`Could not read ${path}.`);
  }
  return parseEvalSuiteFile(source, path);
}

/** Validate suite file text; `path` names the file in error messages. */
export function parseEvalSuiteFile(
  source: string,
  path: string
): EvalSuiteFile {
  if (Buffer.byteLength(source) > MAX_BYTES)
    throw new UsageError(`${path}: a suite file must be at most 256 KiB.`);
  const document = parseDocument(source, { prettyErrors: false });
  if (document.errors.length > 0)
    throw new UsageError(
      `${path}: invalid YAML: ${document.errors[0]!.message.split("\n")[0]}`
    );
  let value: unknown;
  try {
    value = document.toJSON();
  } catch {
    throw new UsageError(`${path} could not be decoded as YAML.`);
  }
  const result = fileSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new UsageError(
      `${path}: invalid eval suite at ${issue.path.join(".") || "file"}: ${issue.message}`
    );
  }
  return result.data;
}

/** Steps as Cloud stores them. */
type SavedStep =
  | { kind: "user"; content: string }
  | { kind: "tool_call"; name: string; args?: Record<string, unknown> }
  | { kind: "assistant_text"; note?: string };

/**
 * The Cloud request body that stores `file` as a suite's whole definition.
 * Client selection is spread across `clientTargets`, `clientSettings`, and
 * the legacy `models` / `disallowedTools` fields; all are written together,
 * as the dashboard does. Settings a file cannot express (plugin lifecycle)
 * are kept from `existingClientSettings`.
 */
export function suiteBody(
  file: EvalSuiteFile,
  options: { defaultModel: string; existingClientSettings?: unknown }
) {
  const selected = file.clients ?? {
    inspector: { models: [options.defaultModel] },
    runtimes: [],
    chatgpt: false,
    claude: false,
  };
  const inspectorModels = selected.inspector?.models ?? [];
  const executors = selected.runtimes.map(({ harness, model, provider }) => ({
    harness,
    model,
    ...(provider === undefined ? {} : { provider }),
  }));
  const apps = WEB_CLIENTS.filter((app) => selected[app] !== false);
  const webModels = Object.fromEntries(
    WEB_CLIENTS.flatMap((app) => {
      const setting = selected[app];
      return typeof setting === "object"
        ? [[app, { models: setting.models.map((id) => ({ id, name: "" })) }]]
        : [];
    })
  );
  const {
    inspector: _inspector,
    runtime: _runtime,
    web: _web,
    ...preserved
  } = record(options.existingClientSettings);
  return {
    name: file.name,
    flow: file.flow.map(savedStep),
    threshold: file.threshold,
    disallowedTools: file.disallowedTools,
    models: inspectorModels,
    clientTargets: [
      ...(inspectorModels.length > 0 ? ["inspector"] : []),
      ...apps,
      ...new Set(executors.map((entry) => entry.harness)),
    ],
    clientSettings: {
      ...preserved,
      ...(inspectorModels.length > 0
        ? {
            inspector: {
              modelIds: inspectorModels,
              disallowedToolNames: file.disallowedTools,
            },
          }
        : {}),
      ...(executors.length > 0 ? { runtime: { executors } } : {}),
      ...(Object.keys(webModels).length > 0 ? { web: webModels } : {}),
    },
  };
}

/** A step with absent optional fields omitted rather than `undefined`. */
function savedStep(item: Step): SavedStep {
  if (item.kind === "tool_call")
    return {
      kind: item.kind,
      name: item.name,
      ...(item.args === undefined ? {} : { args: item.args }),
    };
  if (item.kind === "assistant_text")
    return {
      kind: item.kind,
      ...(item.note === undefined ? {} : { note: item.note }),
    };
  return item;
}

/** A saved suite, as Cloud returns it. */
export interface SavedSuite {
  name: string;
  enabled: boolean;
  threshold: number;
  prompt: string | null;
  flow: unknown;
  requiredTools: unknown;
  rubric: string | null;
  models: unknown;
  disallowedTools: unknown;
  clientTargets: unknown;
  clientSettings: unknown;
}

/**
 * Read a saved suite back into the file shape. Legacy columns are read the
 * way runs read them: `clientSettings` wins over `models` and
 * `disallowedTools`, and a suite saved before flows existed becomes a flow
 * of its prompt and required tools.
 */
export function suiteFile(suite: SavedSuite): Record<string, unknown> {
  const settings = record(suite.clientSettings);
  const inspector =
    settings.inspector === undefined ? undefined : record(settings.inspector);
  const known = new Set<string>(["inspector", ...WEB_CLIENTS, ...HARNESSES]);
  const listed = strings(suite.clientTargets).filter((target) =>
    known.has(target)
  );
  const targets = listed.length > 0 ? listed : ["inspector"];
  const inspectorModels = inspector
    ? strings(inspector.modelIds)
    : strings(suite.models);
  const disallowedTools = inspector
    ? strings(inspector.disallowedToolNames)
    : strings(suite.disallowedTools);
  const runtimes = list(record(settings.runtime).executors)
    .map(record)
    .filter(
      (item) =>
        typeof item.harness === "string" &&
        typeof item.model === "string" &&
        targets.includes(item.harness)
    )
    .map(({ harness, model, provider }) => ({
      harness,
      model,
      ...(typeof provider === "string" ? { provider } : {}),
    }));
  const selected: Record<string, unknown> = {
    ...(targets.includes("inspector") && inspectorModels.length > 0
      ? { inspector: { models: inspectorModels } }
      : {}),
    ...(runtimes.length > 0 ? { runtimes } : {}),
    ...Object.fromEntries(
      WEB_CLIENTS.filter((app) => targets.includes(app)).map((app) => {
        const models = list(record(record(settings.web)[app]).models)
          .map((model) => record(model).id)
          .filter((id): id is string => typeof id === "string" && id !== "");
        return [app, models.length > 0 ? { models } : true];
      })
    ),
  };
  return {
    name: suite.name,
    flow: savedFlow(suite),
    ...(suite.rubric ? { rubric: suite.rubric } : {}),
    threshold: suite.threshold,
    ...(Object.keys(selected).length > 0 ? { clients: selected } : {}),
    ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
    ...(suite.enabled ? {} : { enabled: false }),
  };
}

function savedFlow(suite: SavedSuite): SavedStep[] {
  const flow = list(suite.flow).flatMap((value): SavedStep[] => {
    const item = record(value);
    if (item.kind === "user" && typeof item.content === "string")
      return [{ kind: "user", content: item.content }];
    if (item.kind === "tool_call" && typeof item.name === "string")
      return [
        {
          kind: "tool_call",
          name: item.name,
          ...(item.args === undefined ? {} : { args: record(item.args) }),
        },
      ];
    if (item.kind === "assistant_text")
      return [
        {
          kind: "assistant_text",
          ...(typeof item.note === "string" ? { note: item.note } : {}),
        },
      ];
    return [];
  });
  if (flow.length > 0 || !suite.prompt?.trim()) return flow;
  const tools = list(suite.requiredTools).flatMap((tool): SavedStep[] => {
    const item = record(tool);
    if (typeof item.name !== "string" || item.name === "") return [];
    const args = item.args === undefined ? undefined : record(item.args);
    return [{ kind: "tool_call", name: item.name, ...(args ? { args } : {}) }];
  });
  return [{ kind: "user", content: suite.prompt.trim() }, ...tools];
}

/**
 * Serialize JSON data as block YAML. Strings that YAML could read as
 * another type are written as JSON strings, which YAML reads verbatim.
 */
export function toYaml(value: unknown): string {
  return `${block(value, "").replace(/^\n/, "")}\n`;
}

function block(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return " []";
    return value
      .map((item) => {
        const body = block(item, `${indent}  `);
        return isMapping(item) && Object.keys(item).length > 0
          ? `\n${indent}- ${body.trimStart()}`
          : `\n${indent}-${body}`;
      })
      .join("");
  }
  if (isMapping(value)) {
    const entries = Object.entries(value).filter(
      ([, item]) => item !== undefined
    );
    if (entries.length === 0) return " {}";
    return entries
      .map(
        ([key, item]) =>
          `\n${indent}${scalar(key)}:${block(item, `${indent}  `)}`
      )
      .join("");
  }
  return ` ${scalar(value)}`;
}

function scalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const text = String(value);
  const ambiguous =
    text === "" ||
    text !== text.trim() ||
    /^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\.inf|\.nan)|[-+.\d][\d._:eE+-]*)$/i.test(
      text
    ) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(text) ||
    // Control characters need JSON escapes to survive a round trip.
    // eslint-disable-next-line no-control-regex
    /: |\s#|[\n\t\\]|[\x00-\x1f\x7f]/.test(text);
  return ambiguous ? JSON.stringify(text) : text;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
}
