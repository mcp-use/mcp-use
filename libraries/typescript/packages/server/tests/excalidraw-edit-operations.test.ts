import { describe, expect, it } from "vitest";

import {
  applyDrawingChanges,
  editDrawingInputSchema,
  type SceneElement,
} from "../examples/views/excalidraw/views/excalidraw/edit-operations.js";

const convertElements = (elements: readonly Record<string, unknown>[]) =>
  elements.map((element) => ({
    ...element,
    version: 1,
  })) as SceneElement[];

describe("Excalidraw in-place edit operations", () => {
  it("applies sequential updates, bound-label moves, creates, and deletes", () => {
    const current: SceneElement[] = [
      {
        id: "box",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 160,
        height: 80,
        version: 1,
        boundElements: [{ id: "box-label", type: "text" }],
      },
      {
        id: "box-label",
        type: "text",
        x: 50,
        y: 45,
        text: "Old",
        originalText: "Old",
        containerId: "box",
        version: 1,
      },
      {
        id: "obsolete",
        type: "ellipse",
        x: 300,
        y: 20,
        width: 80,
        height: 80,
        version: 1,
      },
    ];
    const input = editDrawingInputSchema.parse({
      changes: [
        {
          type: "update",
          target: { ids: ["box"] },
          patch: {
            x: 30,
            backgroundColor: "#fff3bf",
            label: { text: "New" },
          },
        },
        {
          type: "move",
          target: { ids: ["box"] },
          deltaX: 10,
          deltaY: 15,
        },
        {
          type: "create",
          elements: [
            {
              type: "arrow",
              id: "new-arrow",
              x: 200,
              y: 60,
              points: [
                [0, 0],
                [80, 0],
              ],
            },
          ],
        },
        { type: "delete", target: { ids: ["obsolete"] } },
      ],
    });

    const result = applyDrawingChanges(current, input, [], convertElements);

    expect(result.elements.map((element) => element.id)).toEqual([
      "box",
      "box-label",
      "new-arrow",
    ]);
    expect(
      result.elements.find((element) => element.id === "box")
    ).toMatchObject({
      x: 40,
      y: 35,
      backgroundColor: "#fff3bf",
    });
    expect(
      result.elements.find((element) => element.id === "box-label")
    ).toMatchObject({
      x: 80,
      y: 60,
      text: "New",
      originalText: "New",
    });
    expect(result.changedIds).toEqual(
      expect.arrayContaining(["box", "box-label", "new-arrow", "obsolete"])
    );
  });

  it("targets the current fullscreen selection", () => {
    const current: SceneElement[] = [
      { id: "one", type: "rectangle", x: 0, y: 0, version: 1 },
      { id: "two", type: "rectangle", x: 20, y: 20, version: 1 },
    ];
    const input = editDrawingInputSchema.parse({
      changes: [
        {
          type: "move",
          target: { selected: true },
          deltaX: 5,
          deltaY: -10,
        },
      ],
    });

    const result = applyDrawingChanges(
      current,
      input,
      ["two"],
      convertElements
    );

    expect(result.elements[0]).toMatchObject({ id: "one", x: 0, y: 0 });
    expect(result.elements[1]).toMatchObject({ id: "two", x: 25, y: 10 });
  });

  it("removes bound labels when replacing their container", () => {
    const current: SceneElement[] = [
      {
        id: "old",
        type: "rectangle",
        x: 0,
        y: 0,
        boundElements: [{ id: "old-label", type: "text" }],
      },
      {
        id: "old-label",
        type: "text",
        x: 20,
        y: 20,
        containerId: "old",
      },
    ];
    const input = editDrawingInputSchema.parse({
      changes: [
        {
          type: "replace",
          target: { ids: ["old"] },
          elements: [
            {
              type: "ellipse",
              id: "replacement",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            },
          ],
        },
      ],
    });

    const result = applyDrawingChanges(current, input, [], convertElements);

    expect(result.elements.map((element) => element.id)).toEqual([
      "replacement",
    ]);
  });

  it("rejects unsafe or ambiguous updates at the schema boundary", () => {
    expect(() =>
      editDrawingInputSchema.parse({
        changes: [
          {
            type: "update",
            target: { ids: ["box"] },
            patch: { id: "renamed" },
          },
        ],
      })
    ).toThrow();

    expect(() =>
      editDrawingInputSchema.parse({
        changes: [
          {
            type: "delete",
            target: {},
          },
        ],
      })
    ).toThrow();
  });
});
