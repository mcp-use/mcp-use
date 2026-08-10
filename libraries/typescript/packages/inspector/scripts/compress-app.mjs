import { gzipSync } from "node:zlib";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("../dist/app/", import.meta.url));

for (const filename of ["inspector.js", "inspector.css"]) {
  const source = join(appDir, filename);
  const compressed = gzipSync(readFileSync(source), { level: 9 });
  writeFileSync(`${source}.gz`, compressed);
  unlinkSync(source);
}
