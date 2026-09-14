import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runProcess } from "./process.mjs";

for (const reason of ["timeout", "abort"]) {
  test(
    `terminates an uncooperative child and its descendant on ${reason}`,
    { timeout: 10_000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "cli-process-test-"));
      const pidFile = join(root, "pid");
      t.after(async () => {
        // A regression in the helper must not leave the regression test's children alive.
        for (const path of [pidFile, `${pidFile}.descendant`]) {
          try {
            process.kill(Number(await readFile(path, "utf8")), "SIGKILL");
          } catch (error) {
            if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
          }
        }
        await rm(root, { recursive: true, force: true });
      });
      const controller = new AbortController();
      const child = runProcess(
        process.execPath,
        [
          "-e",
          `
      require('node:fs').writeFileSync(process.argv[1], String(process.pid));
      require('node:child_process').spawn(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);", process.argv[1] + '.descendant'], { stdio: 'inherit' });
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `,
          pidFile,
        ],
        { timeout: 1_500, signal: controller.signal }
      );
      const assertion = assert.rejects(
        child,
        reason === "timeout" ? /timed out/ : /test cancellation/
      );
      if (reason === "abort") {
        const timer = setTimeout(
          () => controller.abort(new Error("test cancellation")),
          500
        );
        t.after(() => clearTimeout(timer));
      }
      await assertion;
      const pid = Number(await readFile(pidFile, "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      const descendant = Number(
        await readFile(`${pidFile}.descendant`, "utf8")
      );
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          process.kill(descendant, 0);
        } catch (error) {
          if (error.code === "ESRCH") return;
          throw error;
        }
        await delay(20);
      }
      assert.fail("descendant process survived cancellation");
    }
  );
}
