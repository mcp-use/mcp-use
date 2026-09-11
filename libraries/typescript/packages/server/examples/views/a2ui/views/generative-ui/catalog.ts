import { z } from "zod";

const id = z
  .string()
  .regex(/^[a-zA-Z][\w-]*$/)
  .max(64);
const binding = z.object({ path: z.string().regex(/^\/[\w-]+$/) });
const text = z.union([z.string().max(3000), binding]);
const component = z.discriminatedUnion("component", [
  z.object({
    id,
    component: z.literal("Text"),
    text,
    variant: z
      .enum(["h1", "h2", "h3", "h4", "h5", "body", "caption"])
      .optional(),
  }),
  z.object({
    id,
    component: z.literal("Column"),
    children: z.array(id).max(40),
  }),
  z.object({ id, component: z.literal("Row"), children: z.array(id).max(8) }),
  z.object({ id, component: z.literal("Card"), child: id }),
  z.object({ id, component: z.literal("Divider") }),
  z.object({
    id,
    component: z.literal("CheckBox"),
    label: text,
    value: binding,
  }),
  z.object({
    id,
    component: z.literal("TextField"),
    label: text,
    value: binding,
    variant: z.enum(["shortText", "longText", "number"]).optional(),
  }),
  z.object({
    id,
    component: z.literal("Slider"),
    label: text,
    value: binding,
    min: z.number(),
    max: z.number(),
  }),
  z.object({
    id,
    component: z.literal("ChoicePicker"),
    label: text,
    value: binding,
    options: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .min(1)
      .max(12),
    variant: z.enum(["mutuallyExclusive", "multipleSelection"]),
  }),
]);

/** A small subset of A2UI's basic catalog, shared by the tool and view. */
export const specSchema = z
  .object({
    components: z
      .array(component)
      .min(1)
      .max(64)
      .describe(
        "A2UI components with unique IDs. The root component must have id 'root'. Layouts reference children by ID."
      ),
    data: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
      )
      .describe(
        "Initial values for every /key binding. CheckBox uses a boolean, Slider a number, TextField a string, ChoicePicker a string array."
      ),
  })
  .superRefine((spec, ctx) => {
    const nodes = new Map(spec.components.map((node) => [node.id, node]));
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (nodes.size !== spec.components.length)
      fail("Component IDs must be unique.");
    if (!nodes.has("root")) fail("Include a component with id 'root'.");
    const visited = new Set<string>();
    function visit(key: string, ancestors = new Set<string>()) {
      if (ancestors.has(key)) {
        fail(`Circular component reference: ${key}`);
        return;
      }
      if (visited.has(key)) return;
      const node = nodes.get(key);
      if (!node) {
        fail(`Missing component: ${key}`);
        return;
      }
      const path = new Set([...ancestors, key]);
      for (const child of "children" in node
        ? node.children
        : "child" in node
          ? [node.child]
          : [])
        visit(child, path);
      visited.add(key);
    }
    for (const node of spec.components) {
      visit(node.id);
      for (const value of Object.values(node)) {
        if (
          value &&
          typeof value === "object" &&
          "path" in value &&
          !Object.hasOwn(spec.data, value.path.slice(1))
        )
          fail(`Missing initial data for ${value.path}`);
      }
      if ("value" in node) {
        const value = spec.data[node.value.path.slice(1)];
        const valid =
          node.component === "CheckBox"
            ? typeof value === "boolean"
            : node.component === "Slider"
              ? typeof value === "number" &&
                node.min < node.max &&
                value >= node.min &&
                value <= node.max
              : node.component === "ChoicePicker"
                ? Array.isArray(value) &&
                  value.every((item) =>
                    node.options.some((option) => option.value === item)
                  ) &&
                  (node.variant !== "mutuallyExclusive" || value.length <= 1)
                : typeof value === "string";
        if (!valid)
          fail(
            `Invalid initial value or range for ${node.id} (${node.component}).`
          );
      }
    }
  });

/** Validated model-generated A2UI layout and initial data. */
export type UISpec = z.infer<typeof specSchema>;
