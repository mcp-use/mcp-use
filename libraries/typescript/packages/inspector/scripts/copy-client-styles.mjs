import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const source = join(packageRoot, "src/client/styles.css");
const destination = join(packageRoot, "dist/client/styles.css");

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
