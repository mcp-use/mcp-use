import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { Env } from "hono";
import type { OAuthMode, RequestContext } from "./context.js";
import type { ToolDefinition } from "./tools.js";

/** Native primitive setting and its presentation metadata. */
export interface SettingsField<
  Schema extends StandardSchemaWithJSON = StandardSchemaWithJSON,
> {
  /**
   * Primitive Standard Schema with JSON Schema conversion; read() returns effective values.
   * Validation must preserve supplied values; value-changing transforms are rejected at runtime.
   */
  schema: Schema;
  /** Non-blank label displayed by the host. */
  title: string;
  /** Optional explanatory text displayed by the host. */
  description?: string;
}
/** Named primitive settings. */
export type SettingsFields = Record<string, SettingsField>;
/** Complete effective values inferred from the registered field schemas. */
export type SettingsValues<Fields extends SettingsFields> = {
  -readonly [Key in keyof Fields]-?: Exclude<
    StandardSchemaWithJSON.InferOutput<Fields[Key]["schema"]>,
    undefined
  >;
};
/** A native settings section containing field controls and same-server actions. */
export interface SettingsLayoutGroup<Key extends string = string> {
  /** Identifies a group; nested groups are unsupported. */
  kind: "group";
  /** Non-blank section heading. */
  title: string;
  /** Ordered controls; omitted fields appear in the host's Other settings section. */
  items: readonly (
    | {
        /** Identifies a field control. */ kind: "property";
        /** Registered field key. */ property: Key;
      }
    | {
        /** Identifies an action button. */ kind: "tool";
        /** Same-server tool accepting empty arguments. */ tool: string;
        /** Button label. */ title: string;
        /** Optional button description. */ description?: string;
      }
  )[];
}
/** Register native plugin settings; persistence and authorization remain application-owned. */
export interface SettingsRegistration<
  Fields extends SettingsFields,
  TUser = never,
  HasOAuth extends OAuthMode = false,
  TEnv extends Env = Env,
> {
  /** At least one field convertible to boolean, string, string enum, number, or integer JSON Schema. */
  fields: Fields;
  /** Read tool name; defaults to settings.read. */
  readTool?: string;
  /** Update tool name; defaults to settings.update. */
  updateTool?: string;
  /** Optional grouped controls and action buttons. */
  layout?: readonly SettingsLayoutGroup<NoInfer<keyof Fields & string>>[];
  /** Authorize and return every effective value, including application defaults, without mutation. */
  read: (
    ctx: RequestContext<TUser, HasOAuth, TEnv>
  ) => SettingsValues<Fields> | Promise<SettingsValues<Fields>>;
  /** Authorize, preserve omitted fields, persist changes atomically, then return every effective value. */
  update: (
    set: Partial<SettingsValues<Fields>>,
    ctx: RequestContext<TUser, HasOAuth, TEnv>
  ) => SettingsValues<Fields> | Promise<SettingsValues<Fields>>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function nonBlank(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${label} must be a non-blank string`);
}
function standard<T>(
  json: Record<string, unknown>,
  validate: (value: unknown) => T | Promise<T>
): StandardSchemaWithJSON<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "mcp-use",
      jsonSchema: { input: () => json, output: () => json },
      async validate(value) {
        try {
          return { value: await validate(value) };
        } catch (error) {
          return {
            issues: [
              {
                message: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      },
    },
  };
}

/** Capture schemas/layout and derive validated settings tools without invoking handlers. @internal */
export function prepareSettings<Fields extends SettingsFields>(
  options: Pick<
    SettingsRegistration<Fields>,
    "fields" | "layout" | "readTool" | "updateTool"
  >
) {
  const readTool = options.readTool ?? "settings.read";
  const updateTool = options.updateTool ?? "settings.update";
  nonBlank(readTool, "readTool");
  nonBlank(updateTool, "updateTool");
  if (readTool === updateTool)
    throw new TypeError(
      "Settings read and update tools must have different names"
    );
  object(options.fields, "fields");
  const fields: [string, SettingsField][] = Object.entries(options.fields).map(
    ([name, field]) => [name, { ...field }]
  );
  if (!fields.length)
    throw new TypeError("Settings require at least one field");
  const properties: Record<string, unknown> = {};
  for (const [name, field] of fields) {
    nonBlank(field.title, `Setting ${name} title`);
    if (
      field.description !== undefined &&
      typeof field.description !== "string"
    )
      throw new TypeError(`Setting ${name} description must be a string`);
    const outputProperty = field.schema["~standard"].jsonSchema.output({
      target: "draft-2020-12",
    });
    const property = field.schema["~standard"].jsonSchema.input({
      target: "draft-2020-12",
    });
    if (
      !["boolean", "string", "number", "integer"].includes(
        String(property["type"])
      ) ||
      outputProperty["type"] !== property["type"] ||
      ["$ref", "anyOf", "oneOf", "allOf"].some((key) => key in property) ||
      (property["enum"] !== undefined &&
        (property["type"] !== "string" ||
          !Array.isArray(property["enum"]) ||
          !property["enum"].length ||
          !property["enum"].every((item) => typeof item === "string")))
    ) {
      throw new TypeError(
        `Unsupported native setting ${name}: use boolean, string, string enum, number, or integer`
      );
    }
    const wireProperty = structuredClone(property);
    delete wireProperty["default"];
    Object.defineProperty(properties, name, {
      enumerable: true,
      value: {
        ...wireProperty,
        title: field.title,
        ...(field.description !== undefined && {
          description: field.description,
        }),
      },
    });
  }
  const schema = {
    type: "object",
    properties,
    required: fields.map(([name]) => name),
    additionalProperties: false,
  };
  const layout =
    options.layout === undefined ? undefined : structuredClone(options.layout);
  if (layout !== undefined) {
    if (!Array.isArray(layout))
      throw new TypeError("Settings layout must be an array");
    for (const groupValue of layout) {
      const group = object(groupValue, "Settings layout group");
      if (group.kind !== "group")
        throw new TypeError("Settings layout groups must have kind 'group'");
      nonBlank(group.title, "Settings layout group title");
      if (!Array.isArray(group.items))
        throw new TypeError("Settings layout group items must be an array");
      for (const itemValue of group.items) {
        const item = object(itemValue, "Settings layout item");
        if (item.kind === "property") {
          nonBlank(item.property, "Settings layout property");
          if (!Object.hasOwn(properties, item.property))
            throw new TypeError(
              `Settings layout references unknown setting: ${item.property}`
            );
        } else if (item.kind === "tool") {
          nonBlank(item.tool, "Settings layout action tool");
          nonBlank(item.title, "Settings layout action title");
          if (
            item.description !== undefined &&
            typeof item.description !== "string"
          )
            throw new TypeError(
              "Settings layout action description must be a string"
            );
        } else {
          throw new TypeError(
            "Settings layout items must have kind 'property' or 'tool'"
          );
        }
      }
    }
  }
  const validateValues = async (
    value: unknown,
    partial = false
  ): Promise<Record<string, unknown>> => {
    const values = object(value, partial ? "set" : "values");
    for (const name of Object.keys(values))
      if (!Object.hasOwn(properties, name))
        throw new TypeError(`Unknown setting: ${name}`);
    if (partial && !Object.keys(values).length)
      throw new TypeError("Set at least one setting");
    const result: Record<string, unknown> = {};
    for (const [name, field] of fields) {
      if (!Object.hasOwn(values, name)) {
        if (!partial) throw new TypeError(`Missing effective setting: ${name}`);
        continue;
      }
      const parsed = await field.schema["~standard"].validate(values[name]);
      if (parsed.issues !== undefined)
        throw new TypeError(
          `Invalid setting ${name}: ${parsed.issues.map((issue) => issue.message).join(", ")}`
        );
      if (
        parsed.value === undefined ||
        !["string", "boolean", "number"].includes(typeof parsed.value) ||
        (typeof parsed.value === "number" && !Number.isFinite(parsed.value))
      )
        throw new TypeError(`Invalid primitive setting: ${name}`);
      // Standard Schema exposes only an input parser, not an output validator.
      // Never silently transform values already made effective by callbacks.
      if (!Object.is(parsed.value, values[name]))
        throw new TypeError(`Setting ${name} schema must not transform values`);
      Object.defineProperty(result, name, {
        enumerable: true,
        value: parsed.value,
      });
    }
    return result;
  };
  const emptySchema = standard(
    { type: "object", additionalProperties: false },
    (value) => {
      if (Object.keys(object(value, "arguments")).length)
        throw new TypeError("Settings read accepts empty arguments");
      return {};
    }
  );
  const updateInput = standard(
    {
      type: "object",
      properties: { set: { ...schema, required: [], minProperties: 1 } },
      required: ["set"],
      additionalProperties: false,
    },
    async (value) => {
      const input = object(value, "arguments");
      if (Object.keys(input).some((key) => key !== "set"))
        throw new TypeError("Unknown settings update argument");
      return { set: await validateValues(input["set"], true) };
    }
  );
  const layoutJson = {
    type: "array",
    items: {
      type: "object",
      properties: {
        kind: { const: "group" },
        title: { type: "string" },
        items: { type: "array", items: { type: "object" } },
      },
      required: ["kind", "title", "items"],
    },
  };
  const readOutput = standard(
    {
      type: "object",
      properties: {
        schema: { type: "object" },
        values: schema,
        layout: layoutJson,
      },
      required: ["schema", "values"],
    },
    async (value) => {
      const output = object(value, "settings result");
      return { ...output, values: await validateValues(output["values"]) };
    }
  );
  const updateOutput = standard(
    { type: "object", properties: { values: schema }, required: ["values"] },
    async (value) => ({
      values: await validateValues(object(value, "settings result")["values"]),
    })
  );
  return {
    capability: { readTool, updateTool },
    schema,
    layout,
    readDefinition: {
      name: readTool,
      inputSchema: emptySchema,
      outputSchema: readOutput,
      annotations: { readOnlyHint: true },
    } satisfies ToolDefinition,
    updateDefinition: {
      name: updateTool,
      inputSchema: updateInput,
      outputSchema: updateOutput,
    } satisfies ToolDefinition,
  };
}
