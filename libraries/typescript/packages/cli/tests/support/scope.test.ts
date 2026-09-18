import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { it } from "./fixtures.js";
import { TestScope } from "./scope.js";

it("cancels stalled cleanup and waits for cancellation before deleting files", async ({
  scope,
}) => {
  const owner = new TestScope(scope.directory(), { timeout: 20, grace: 100 });
  const directory = owner.directory();
  let cancelled = false;
  owner.defer(
    (signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            expect(existsSync(directory)).toBe(true);
            cancelled = true;
            resolve();
          },
          { once: true }
        );
      }),
    "cancellable resource"
  );
  await owner.dispose();
  expect(cancelled).toBe(true);
  if (process.env.KEEP_TEST_PROJECTS !== "1")
    expect(existsSync(directory)).toBe(false);
});

it("reports a stuck resource, continues other cleanup, restores state, and retains its files", async ({
  scope,
}) => {
  const root = scope.directory();
  const owner = new TestScope(root, { timeout: 20, grace: 20 });
  const directory = owner.directory();
  const state = { value: "before" };
  owner.preserveProperty(state, "value");
  state.value = "during";
  let closed = false;
  owner.defer(() => {
    closed = true;
  });
  owner.defer(() => new Promise<void>(() => {}), "stuck test server");
  await expect(owner.dispose()).rejects.toMatchObject({
    errors: [
      expect.objectContaining({
        message: expect.stringContaining("stuck test server did not stop"),
      }),
    ],
  });
  expect(closed).toBe(true);
  expect(state.value).toBe("before");
  expect(existsSync(directory)).toBe(true);
  expect(existsSync(join(root, ".cleanup-incomplete"))).toBe(true);
  expect(() => owner.directory()).toThrow("after test teardown");
});
