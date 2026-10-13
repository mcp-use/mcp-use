import assert from "node:assert/strict";
import { test } from "node:test";
import { specSchema } from "../views/generative-ui/catalog.ts";

test("accepts a connected layout with typed control data", () => {
  assert.equal(
    specSchema.safeParse({
      components: [
        { id: "root", component: "Column", children: ["choice"] },
        {
          id: "choice",
          component: "ChoicePicker",
          label: "Pick one",
          value: { path: "/selected" },
          options: [{ label: "One", value: "one" }],
          variant: "mutuallyExclusive",
        },
      ],
      data: { selected: ["one"] },
    }).success,
    true
  );
});

test("rejects components that would silently disappear outside the root tree", () => {
  assert.equal(
    specSchema.safeParse({
      components: [
        { id: "root", component: "Column", children: [] },
        { id: "orphan", component: "Text", text: "Lost" },
      ],
      data: {},
    }).success,
    false
  );
});

test("rejects cyclic layouts without recursing indefinitely", () => {
  assert.equal(
    specSchema.safeParse({
      components: [{ id: "root", component: "Column", children: ["root"] }],
      data: {},
    }).success,
    false
  );
});

for (const field of ["label", "value"]) {
  test(`rejects oversized choice ${field}`, () => {
    assert.equal(
      specSchema.safeParse({
        components: [
          {
            id: "root",
            component: "ChoicePicker",
            label: "Pick",
            value: { path: "/selected" },
            options: [
              { label: "One", value: "one", [field]: "x".repeat(3001) },
            ],
            variant: "multipleSelection",
          },
        ],
        data: { selected: [] },
      }).success,
      false
    );
  });
}
