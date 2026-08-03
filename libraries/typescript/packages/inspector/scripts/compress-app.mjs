import { gzipSync } from "node:zlib";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const appDir = new URL("../dist/app/", import.meta.url);

for (const filename of ["inspector.js", "inspector.css"]) {
  const source = join(appDir.pathname, filename);
  const compressed = gzipSync(readFileSync(source), { level: 9 });
  writeFileSync(`${source}.gz`, compressed);
  unlinkSync(source);
}
