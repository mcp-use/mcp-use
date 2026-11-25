import { afterAll, beforeAll } from "vitest";
import { fixtureDir, openTarget, type Target } from "../src/target.js";

/** Whether a staged fixture exists; scenario files skip entirely without one. */
export const hasFixture = fixtureDir() !== undefined;

/** Opens the target once per scenario file and closes it afterwards. */
export function useTarget(): () => Target {
  let target: Target | undefined;
  beforeAll(async () => {
    target = await openTarget();
  }, 600_000);
  afterAll(async () => {
    await target?.close();
  });
  return () => {
    if (!target) throw new Error("target not open");
    return target;
  };
}

/** Text of the first content block of a tools/call result. */
export function toolText(result: any): string {
  return result?.content?.[0]?.text ?? "";
}
