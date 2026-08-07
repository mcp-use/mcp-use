import { z } from "zod";

const finiteNumber = z.number().finite();
const elementId = z.string().trim().min(1).max(128);
const color = z.string().trim().min(1).max(64);

const bindingSchema = z
  .object({
    elementId,
    focus: finiteNumber.optional(),
    gap: finiteNumber.optional(),
    fixedPoint: z.tuple([finiteNumber, finiteNumber]).nullable().optional(),
  })
  .strict();

const labelSchema = z
  .object({
    text: z.string().max(2_000),
    fontSize: finiteNumber.min(8).max(96).optional(),
  })
  .strict();

const commonElementFields = {
  id: elementId,
  x: finiteNumber,
  y: finiteNumber,
  strokeColor: color.optional(),
  backgroundColor: color.optional(),
  fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]).optional(),
  strokeWidth: finiteNumber.min(0.5).max(20).optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  roughness: finiteNumber.min(0).max(2).optional(),
  opacity: finiteNumber.min(1).max(100).optional(),
  angle: finiteNumber.optional(),
};

const shapeElementSchema = z
  .object({
    ...commonElementFields,
    type: z.enum(["rectangle", "ellipse", "diamond"]),
    width: finiteNumber.positive().max(20_000),
    height: finiteNumber.positive().max(20_000),
    roundness: z
      .object({ type: z.union([z.literal(1), z.literal(2), z.literal(3)]) })
      .strict()
      .optional(),
    label: labelSchema.optional(),
  })
  .strict();

const textElementSchema = z
  .object({
    ...commonElementFields,
    type: z.literal("text"),
    text: z.string().max(10_000),
    fontSize: finiteNumber.min(8).max(96).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
  })
  .strict();

const arrowElementSchema = z
  .object({
    ...commonElementFields,
    type: z.literal("arrow"),
    width: finiteNumber.optional(),
    height: finiteNumber.optional(),
    points: z
      .array(z.tuple([finiteNumber, finiteNumber]))
      .min(2)
      .max(100),
    startArrowhead: z
      .enum(["arrow", "bar", "dot", "triangle"])
      .nullable()
      .optional(),
    endArrowhead: z
      .enum(["arrow", "bar", "dot", "triangle"])
      .nullable()
      .optional(),
    startBinding: bindingSchema.nullable().optional(),
    endBinding: bindingSchema.nullable().optional(),
    label: labelSchema.optional(),
  })
  .strict();

/** Structured shorthand accepted when a model creates or replaces elements. */
export const editableElementSchema = z.discriminatedUnion("type", [
  shapeElementSchema,
  textElementSchema,
  arrowElementSchema,
]);

const targetSchema = z
  .object({
    ids: z.array(elementId).min(1).max(100).optional(),
    selected: z
      .boolean()
      .optional()
      .describe("Also target elements selected in the fullscreen editor."),
  })
  .strict()
  .refine((target) => target.ids !== undefined || target.selected === true, {
    message: "Provide ids or set selected to true.",
  });

const elementPatchSchema = z
  .object({
    x: finiteNumber.optional(),
    y: finiteNumber.optional(),
    width: finiteNumber.positive().max(20_000).optional(),
    height: finiteNumber.positive().max(20_000).optional(),
    angle: finiteNumber.optional(),
    strokeColor: color.optional(),
    backgroundColor: color.optional(),
    fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]).optional(),
    strokeWidth: finiteNumber.min(0.5).max(20).optional(),
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    roughness: finiteNumber.min(0).max(2).optional(),
    opacity: finiteNumber.min(1).max(100).optional(),
    roundness: z
      .object({ type: z.union([z.literal(1), z.literal(2), z.literal(3)]) })
      .strict()
      .optional(),
    points: z
      .array(z.tuple([finiteNumber, finiteNumber]))
      .min(2)
      .max(100)
      .optional(),
    startArrowhead: z
      .enum(["arrow", "bar", "dot", "triangle"])
      .nullable()
      .optional(),
    endArrowhead: z
      .enum(["arrow", "bar", "dot", "triangle"])
      .nullable()
      .optional(),
    startBinding: bindingSchema.nullable().optional(),
    endBinding: bindingSchema.nullable().optional(),
    text: z.string().max(10_000).optional(),
    fontSize: finiteNumber.min(8).max(96).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    label: labelSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Update patch cannot be empty.",
  });

const createChangeSchema = z
  .object({
    type: z.literal("create"),
    elements: z.array(editableElementSchema).min(1).max(50),
  })
  .strict();

const updateChangeSchema = z
  .object({
    type: z.literal("update"),
    target: targetSchema,
    patch: elementPatchSchema,
  })
  .strict();

const moveChangeSchema = z
  .object({
    type: z.literal("move"),
    target: targetSchema,
    deltaX: finiteNumber,
    deltaY: finiteNumber,
  })
  .strict();

const deleteChangeSchema = z
  .object({
    type: z.literal("delete"),
    target: targetSchema,
  })
  .strict();

const replaceChangeSchema = z
  .object({
    type: z.literal("replace"),
    target: targetSchema,
    elements: z.array(editableElementSchema).min(1).max(50),
  })
  .strict();

/** Input contract for the live `edit_drawing` view tool. */
export const editDrawingInputSchema = z
  .object({
    changes: z
      .array(
        z.discriminatedUnion("type", [
          createChangeSchema,
          updateChangeSchema,
          moveChangeSchema,
          deleteChangeSchema,
          replaceChangeSchema,
        ])
      )
      .min(1)
      .max(100)
      .describe("Changes are applied sequentially and atomically."),
  })
  .strict();

/** Result contract returned to the model after an in-place canvas edit. */
export const editDrawingOutputSchema = z.object({
  checkpointId: z.string(),
  appliedChanges: z.number().int().nonnegative(),
  elementIds: z.array(z.string()),
});

/** Parsed input accepted by {@link applyDrawingChanges}. */
export type EditDrawingInput = z.infer<typeof editDrawingInputSchema>;

/** Minimal scene element shape used by the edit reducer. */
export type SceneElement = Record<string, unknown> & {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  version?: number;
  containerId?: string | null;
};

/** Successful output from {@link applyDrawingChanges}. */
export interface AppliedDrawingChanges {
  /** Complete live scene after all changes. */
  elements: SceneElement[];
  /** IDs directly or indirectly touched by the changes. */
  changedIds: string[];
}

type ConvertElements = (
  elements: z.infer<typeof editableElementSchema>[]
) => SceneElement[];

function touched(element: SceneElement, patch: Record<string, unknown>) {
  return {
    ...element,
    ...patch,
    version: (element.version ?? 0) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  } satisfies SceneElement;
}

function targetIds(
  target: z.infer<typeof targetSchema>,
  selectedIds: readonly string[]
): string[] {
  return [
    ...new Set([
      ...(target.ids ?? []),
      ...(target.selected === true ? selectedIds : []),
    ]),
  ];
}

function assertTargetsExist(elements: SceneElement[], ids: string[]): void {
  if (ids.length === 0) {
    throw new Error("No elements are selected.");
  }
  const existing = new Set(elements.map((element) => element.id));
  const missing = ids.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    throw new Error(`Element IDs not found: ${missing.join(", ")}.`);
  }
}

function removeElements(
  elements: SceneElement[],
  ids: string[]
): SceneElement[] {
  const removed = new Set(ids);
  for (const element of elements) {
    if (
      typeof element.containerId === "string" &&
      removed.has(element.containerId)
    ) {
      removed.add(element.id);
    }
  }

  return elements
    .filter((element) => !removed.has(element.id))
    .map((element) => {
      if (!Array.isArray(element.boundElements)) return element;
      const boundElements = element.boundElements.filter(
        (binding): binding is { id: string; type: string } =>
          typeof binding === "object" &&
          binding !== null &&
          "id" in binding &&
          typeof binding.id === "string" &&
          !removed.has(binding.id)
      );
      return boundElements.length === element.boundElements.length
        ? element
        : touched(element, { boundElements });
    });
}

function addElements(
  elements: SceneElement[],
  raw: z.infer<typeof editableElementSchema>[],
  convertElements: ConvertElements
): { elements: SceneElement[]; addedIds: string[] } {
  const converted = convertElements(raw);
  const existing = new Set(elements.map((element) => element.id));
  const duplicate = converted.find((element) => existing.has(element.id));
  if (duplicate) {
    throw new Error(
      `Element ID "${duplicate.id}" already exists. Use update or replace, or choose a new ID.`
    );
  }
  const addedIds = converted.map((element) => element.id);
  if (new Set(addedIds).size !== addedIds.length) {
    throw new Error("Created elements contain duplicate IDs.");
  }
  return { elements: [...elements, ...converted], addedIds };
}

/**
 * Apply bounded model-authored changes to an existing Excalidraw scene.
 *
 * The reducer is atomic: validation or a missing target throws before the
 * returned scene can replace the live canvas. Generated label elements are
 * supplied by the same shorthand converter used for the initial drawing.
 *
 * @param currentElements - Current non-deleted Excalidraw scene.
 * @param input - Validated structured edit request.
 * @param selectedIds - Current fullscreen selection, if any.
 * @param convertElements - Existing shorthand-to-Excalidraw converter.
 * @returns The complete updated scene and touched element IDs.
 */
export function applyDrawingChanges(
  currentElements: readonly SceneElement[],
  input: EditDrawingInput,
  selectedIds: readonly string[],
  convertElements: ConvertElements
): AppliedDrawingChanges {
  let elements = currentElements.map((element) => ({ ...element }));
  const changedIds = new Set<string>();

  for (const change of input.changes) {
    if (change.type === "create") {
      const added = addElements(elements, change.elements, convertElements);
      elements = added.elements;
      added.addedIds.forEach((id) => changedIds.add(id));
      continue;
    }

    const ids = targetIds(change.target, selectedIds);
    assertTargetsExist(elements, ids);

    if (change.type === "delete") {
      const before = new Set(elements.map((element) => element.id));
      elements = removeElements(elements, ids);
      const after = new Set(elements.map((element) => element.id));
      for (const id of before) {
        if (!after.has(id)) changedIds.add(id);
      }
      continue;
    }

    if (change.type === "replace") {
      const withoutTargets = removeElements(elements, ids);
      const added = addElements(
        withoutTargets,
        change.elements,
        convertElements
      );
      elements = added.elements;
      ids.forEach((id) => changedIds.add(id));
      added.addedIds.forEach((id) => changedIds.add(id));
      continue;
    }

    if (change.type === "move") {
      const movedIds = new Set(ids);
      for (const element of elements) {
        if (
          typeof element.containerId === "string" &&
          movedIds.has(element.containerId)
        ) {
          movedIds.add(element.id);
        }
      }
      elements = elements.map((element) => {
        if (!movedIds.has(element.id)) return element;
        changedIds.add(element.id);
        return touched(element, {
          x: (element.x ?? 0) + change.deltaX,
          y: (element.y ?? 0) + change.deltaY,
        });
      });
      continue;
    }

    const { label, ...patch } = change.patch;
    const idSet = new Set(ids);
    const originalById = new Map(
      elements.map((element) => [element.id, element] as const)
    );
    elements = elements.map((element) => {
      if (!idSet.has(element.id)) return element;
      changedIds.add(element.id);
      return touched(element, patch);
    });

    for (const id of ids) {
      const original = originalById.get(id);
      if (!original) continue;
      const updated = elements.find((element) => element.id === id);
      const deltaX = (updated?.x ?? 0) - (original.x ?? 0);
      const deltaY = (updated?.y ?? 0) - (original.y ?? 0);
      const boundLabels = elements.filter(
        (element) => element.type === "text" && element.containerId === id
      );

      if (label !== undefined && boundLabels.length === 0) {
        throw new Error(
          `Element "${id}" has no bound label. Replace it with a labeled element instead.`
        );
      }

      if (deltaX !== 0 || deltaY !== 0 || label !== undefined) {
        elements = elements.map((element) => {
          if (
            element.type !== "text" ||
            element.containerId !== id ||
            idSet.has(element.id)
          ) {
            return element;
          }
          changedIds.add(element.id);
          return touched(element, {
            ...(deltaX !== 0 || deltaY !== 0
              ? {
                  x: (element.x ?? 0) + deltaX,
                  y: (element.y ?? 0) + deltaY,
                }
              : {}),
            ...(label !== undefined
              ? {
                  text: label.text,
                  originalText: label.text,
                  ...(label.fontSize !== undefined
                    ? { fontSize: label.fontSize }
                    : {}),
                }
              : {}),
          });
        });
      }
    }
  }

  return { elements, changedIds: [...changedIds] };
}
