/**
 * Eval suite files: one YAML (or JSON) document per suite, kept in a
 * repository and pushed by the CLI. The evals section of the CLI reference
 * shows an example.
 *
 * The file format belongs to the CLI, like `alerts`: Cloud's API takes a
 * suite as JSON, so the CLI parses and validates each file here and maps it
 * onto Cloud's suite fields. Every key the format defines is kebab-case; keys
 * under `args` are the tool's own parameter names. A client takes `model` or
 * `models`, not both. A file is the suite's whole definition: an omitted field
 * gets its default, except `clients`, which an existing suite keeps. The
 * experimental clients (`cursor`, the native apps) and plugin lifecycle have
 * no key; a push keeps what the suite has for them.
 */
import { readFile } from "node:fs/promises";
// Bundled validation used by the CLI.
// eslint-disable-next-line import/no-extraneous-dependencies
import { z } from "zod";

import type { operations } from "../api/generated/types.gen.js";
import { parseDocument } from "../../skills/vendor/yaml-2.8.3.min.js";

/** Largest accepted suite file. */
const MAX_BYTES = 256 * 1024;
const DEFAULT_THRESHOLD = 0.7;
/** Agent harnesses `evals options --harness` filters by. */
export const HARNESSES = ["pi", "codex", "claude-code", "cursor"] as const;

/** A suite slug, as Cloud validates it. */
const SUITE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SUITE_SLUG_MAX_LENGTH = 64;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Cloud's limits: required tools, harness executions, models per web app. */
const MAX_REQUIRED_TOOLS = 50;
const MAX_HARNESS_CLIENTS = 12;
const MAX_WEB_MODELS = 10;
const MAX_CLIENTS = 64;

/** Cloud's request body that creates a suite. */
export type CreateBody =
  operations["postApiV1ServerEvalsByServerIdSuites"]["requestBody"]["content"]["application/json"];
/** Cloud's request body that updates a suite. */
export type UpdateBody =
  operations["patchApiV1ServerEvalsByServerIdSuitesBySuiteId"]["requestBody"]["content"]["application/json"];
/** One execution of a suite: a client and the model it runs. */
export type SuiteClient = NonNullable<CreateBody["clients"]>[number];
type RequiredTool = NonNullable<CreateBody["requiredTools"]>[number];

/** File keys under `clients`, and the Cloud client each one runs. */
const FILE_CLIENTS = {
  "manufact-inspector": "inspector",
  "claude-code": "claude-code",
  codex: "codex",
  pi: "pi",
  "chatgpt-web": "chatgpt",
  "claude-web": "claude",
} as const satisfies Record<string, SuiteClient["client"]>;
type FileClientKey = keyof typeof FILE_CLIENTS;
const FILE_CLIENT_KEYS = Object.keys(FILE_CLIENTS) as FileClientKey[];
const WEB_FILE_CLIENTS = new Set<FileClientKey>(["chatgpt-web", "claude-web"]);
const HARNESS_CLIENTS = new Set<string>(HARNESSES);
/** A web app's own default model. */
const DEFAULT_MODEL = "default";

/**
 * Clients a file can't name (`cursor`, the native apps). A push keeps the
 * ones a suite has, since sending `clients` replaces the whole list.
 */
export function isExperimentalClient(client: string): boolean {
  return !Object.values<string>(FILE_CLIENTS).includes(client);
}

const modelId = z.string().trim().min(1).max(200);

const fileClient = (key: FileClientKey) =>
  z
    .strictObject({
      model: modelId.optional(),
      models: z.array(modelId).min(1).optional(),
      ...(key === "claude-code"
        ? { "tool-search": z.boolean().optional() }
        : {}),
    })
    .refine(
      (value) => (value.model === undefined) !== (value.models === undefined),
      { message: "Give `model` or `models`, not both" }
    )
    .refine(
      (value) =>
        WEB_FILE_CLIENTS.has(key) ||
        ![value.model, ...(value.models ?? [])].includes(DEFAULT_MODEL),
      { message: `\`${DEFAULT_MODEL}\` is only for chatgpt-web and claude-web` }
    );
type FileClient = {
  model?: string | undefined;
  models?: string[] | undefined;
  "tool-search"?: unknown;
};

const fileSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .min(1)
    .max(SUITE_SLUG_MAX_LENGTH)
    .refine((id) => UUID_PATTERN.test(id) || SUITE_SLUG_PATTERN.test(id), {
      message:
        "An id is the suite's UUID or a slug: lowercase letters and digits in groups joined by single hyphens, such as rome-weather",
    }),
  name: z.string().trim().min(1).max(255),
  task: z.string().trim().min(1).max(10_000),
  judge: z.string().trim().min(1).max(10_000).optional(),
  threshold: z.number().min(0).max(1).default(DEFAULT_THRESHOLD),
  "required-tools": z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(255),
        args: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .max(MAX_REQUIRED_TOOLS)
    .default([]),
  clients: z
    .strictObject(
      Object.fromEntries(
        FILE_CLIENT_KEYS.map((key) => [key, fileClient(key).optional()])
      ) as {
        [K in FileClientKey]: z.ZodOptional<ReturnType<typeof fileClient>>;
      }
    )
    .refine((value) => Object.values(value).some(Boolean), {
      message: "Select at least one client",
    })
    .optional(),
  enabled: z.boolean().default(true),
});

/** A validated suite file, as Cloud's suite fields. */
export type SuiteFile = {
  /** The suite's UUID or slug. */
  id: string;
  /** Whether `id` is a UUID (it must name an existing suite) rather than a slug. */
  idIsUuid: boolean;
  name: string;
  task: string;
  judge: string | null;
  threshold: number;
  requiredTools: RequiredTool[];
  /** Unset when the file names no clients. */
  clients: SuiteClient[] | undefined;
  enabled: boolean;
};

/** A suite file that can't be used; the message names the field. */
export class SuiteFileError extends Error {}

/** Matcher keys the file spells in kebab-case, and Cloud's names for them. */
const MATCHER_KEYS: Record<string, string> = {
  "require-present": "requirePresent",
};
const MATCHER_FILE_KEYS = Object.fromEntries(
  Object.entries(MATCHER_KEYS).map(([file, cloud]) => [cloud, file])
);

/** An `{ any, require-present }` matcher with its keys renamed; other values as they are. */
function renameMatcherKeys(
  args: Record<string, unknown>,
  names: Record<string, string>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([arg, matcher]) => {
      if (!matcher || typeof matcher !== "object" || Array.isArray(matcher))
        return [arg, matcher];
      const keys = Object.keys(matcher);
      if (
        !keys.includes("any") ||
        !keys.every((key) => key === "any" || key in names)
      )
        return [arg, matcher];
      return [
        arg,
        Object.fromEntries(
          Object.entries(matcher).map(([key, value]) => [
            names[key] ?? key,
            value,
          ])
        ),
      ];
    })
  );
}

/** Read one suite file's text. */
export async function readSuiteFileText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new SuiteFileError(`Could not read ${path}.`);
  }
}

/** Parse and validate suite file text. Errors name the field; the caller adds the path. */
export function parseSuiteFile(source: string): SuiteFile {
  if (Buffer.byteLength(source) > MAX_BYTES)
    throw new SuiteFileError("a suite file must be at most 256 KiB");
  const document = parseDocument(source, { prettyErrors: false });
  if (document.errors.length > 0)
    throw new SuiteFileError(
      `invalid YAML: ${document.errors[0]!.message.split("\n")[0]}`
    );
  let value: unknown;
  try {
    value = document.toJSON();
  } catch {
    throw new SuiteFileError("the file could not be decoded as YAML");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SuiteFileError(
      "a suite file is a mapping of fields, starting with `id:`"
    );
  if (!("id" in value))
    throw new SuiteFileError(
      "add the suite's ID as a top-level `id:` (its slug, such as `id: rome-weather`, or its UUID)"
    );
  const result = fileSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new SuiteFileError(
      `${issue.path.join(".") || "file"}: ${issue.message}`
    );
  }
  const file = result.data;
  const clients = file.clients ? fileClients(file.clients) : undefined;
  return {
    id: file.id,
    idIsUuid: UUID_PATTERN.test(file.id),
    name: file.name,
    task: file.task,
    judge: file.judge ?? null,
    threshold: file.threshold,
    requiredTools: file["required-tools"].map((tool) => ({
      name: tool.name,
      ...(tool.args
        ? { args: renameMatcherKeys(tool.args, MATCHER_KEYS) }
        : {}),
    })),
    clients,
    enabled: file.enabled,
  };
}

/** A file's `clients` map as Cloud's list: one entry per model, checked against Cloud's limits. */
function fileClients(
  map: Partial<Record<FileClientKey, FileClient | undefined>>
): SuiteClient[] {
  const clients: SuiteClient[] = [];
  const seen = new Set<string>();
  for (const key of FILE_CLIENT_KEYS) {
    const spec = map[key];
    if (!spec) continue;
    const toolSearch =
      typeof spec["tool-search"] === "boolean"
        ? spec["tool-search"]
        : undefined;
    for (const model of spec.models ?? [spec.model!]) {
      if (seen.has(`${key}\u0000${model}`))
        throw new SuiteFileError(
          `clients: ${key} lists ${model === DEFAULT_MODEL ? "its default model" : model} twice`
        );
      seen.add(`${key}\u0000${model}`);
      clients.push({
        client: FILE_CLIENTS[key],
        model: model === DEFAULT_MODEL ? null : model,
        ...(toolSearch !== undefined ? { toolSearch } : {}),
      });
    }
  }
  if (clients.length > MAX_CLIENTS)
    throw new SuiteFileError(`clients: at most ${MAX_CLIENTS} executions`);
  if (
    clients.filter((entry) => HARNESS_CLIENTS.has(entry.client)).length >
    MAX_HARNESS_CLIENTS
  )
    throw new SuiteFileError(
      `clients: at most ${MAX_HARNESS_CLIENTS} agent harness executions per suite`
    );
  for (const key of WEB_FILE_CLIENTS)
    if (
      clients.filter((entry) => entry.client === FILE_CLIENTS[key]).length >
      MAX_WEB_MODELS
    )
      throw new SuiteFileError(
        `clients: at most ${MAX_WEB_MODELS} ${key} models`
      );
  return clients;
}

/** The request that creates the suite a file describes, with the file's `id` as its slug. */
export function createBody(file: SuiteFile): CreateBody {
  return {
    name: file.name,
    slug: file.id,
    task: file.task,
    judge: file.judge,
    threshold: file.threshold,
    requiredTools: file.requiredTools,
    ...(file.clients ? { clients: file.clients } : {}),
    enabled: file.enabled,
  };
}

/**
 * The request that makes `existing` what a file describes. Every definition
 * field is sent, so an omitted one is reset to its default. `clients`
 * replaces the whole list, so the experimental clients `existing` has are
 * sent too; a file without `clients` keeps the suite's list as it is.
 */
export function updateBody(
  file: SuiteFile,
  existing: { clients?: readonly SuiteClient[] }
): UpdateBody {
  return {
    name: file.name,
    task: file.task,
    judge: file.judge,
    threshold: file.threshold,
    requiredTools: file.requiredTools,
    ...(file.clients
      ? {
          clients: [
            ...file.clients,
            ...(existing.clients ?? []).filter((entry) =>
              isExperimentalClient(entry.client)
            ),
          ],
        }
      : {}),
    enabled: file.enabled,
  };
}

/** A suite as Cloud returns it, with the fields a file holds. */
export type SuiteDefinition = {
  slug: string;
  name: string;
  task: string | null;
  judge: string | null;
  threshold: number;
  requiredTools: ReadonlyArray<{
    name: string;
    args?: Record<string, unknown>;
  }>;
  clients: readonly SuiteClient[];
  enabled: boolean;
};

/**
 * A suite as file text: its slug as `id`, without the experimental clients.
 * Client entries and argument matchers are written on one line each.
 */
export function suiteFileText(suite: SuiteDefinition): string {
  const clients: Record<string, Record<string, unknown>> = {};
  for (const key of FILE_CLIENT_KEYS) {
    const entries = suite.clients.filter(
      (entry) => entry.client === FILE_CLIENTS[key]
    );
    if (entries.length === 0) continue;
    const models = entries.map((entry) => entry.model ?? DEFAULT_MODEL);
    const toolSearch = entries.find(
      (entry) => entry.toolSearch !== undefined
    )?.toolSearch;
    clients[key] = {
      ...(models.length === 1 ? { model: models[0] } : { models }),
      ...(key === "claude-code" && toolSearch !== undefined
        ? { "tool-search": toolSearch }
        : {}),
    };
  }
  const file = {
    id: suite.slug,
    name: suite.name,
    task: suite.task ?? "",
    ...(suite.judge ? { judge: suite.judge } : {}),
    threshold: suite.threshold,
    ...(suite.requiredTools.length > 0
      ? {
          "required-tools": suite.requiredTools.map((tool) => ({
            name: tool.name,
            ...(tool.args
              ? { args: renameMatcherKeys(tool.args, MATCHER_FILE_KEYS) }
              : {}),
          })),
        }
      : {}),
    ...(Object.keys(clients).length > 0 ? { clients } : {}),
    enabled: suite.enabled,
  };
  const document = parseDocument("");
  const root = document.createNode(file);
  document.contents = root;
  for (const pair of pairs(root)) {
    if (pair.key === "clients")
      for (const client of pairs(pair.value)) setFlow(client.value);
    if (pair.key === "required-tools")
      for (const tool of pair.value?.items ?? [])
        for (const field of pairs(tool as Node))
          if (field.key === "args")
            for (const arg of pairs(field.value)) setFlow(arg.value);
  }
  return document.toString({ lineWidth: 0 });
}

type Node = { flow?: boolean; items?: unknown[] } | undefined;

/** A map node's pairs, with plain keys. */
function pairs(node: Node): Array<{ key: unknown; value: Node }> {
  return (node?.items ?? []).flatMap((item) => {
    const pair = item as { key?: { value?: unknown }; value?: Node };
    return pair && typeof pair === "object" && "key" in pair
      ? [{ key: pair.key?.value, value: pair.value }]
      : [];
  });
}

/** Write a map or sequence node on one line; scalars are left alone. */
function setFlow(node: Node): void {
  if (node && Array.isArray(node.items)) node.flow = true;
}
