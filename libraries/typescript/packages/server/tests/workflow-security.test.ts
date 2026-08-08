import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server examples workflow security", () => {
  it("grants only read access to repository contents by default", async () => {
    const workflow = await readFile(
      new URL(
        "../../../../../.github/workflows/server-examples.yml",
        import.meta.url
      ),
      "utf8"
    );
    const lines = workflow.split("\n");
    const permissionsIndex = lines.indexOf("permissions:");
    const jobsIndex = lines.indexOf("jobs:");

    expect(permissionsIndex).toBeGreaterThan(-1);
    expect(jobsIndex).toBeGreaterThan(permissionsIndex);
    expect(lines.slice(permissionsIndex, jobsIndex)).toEqual([
      "permissions:",
      "  contents: read",
      "",
    ]);
  });
});
