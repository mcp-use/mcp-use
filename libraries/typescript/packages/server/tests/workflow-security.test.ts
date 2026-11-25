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
    // Git for Windows checks files out with CRLF line endings by default.
    const lines = workflow.split(/\r?\n/);
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
