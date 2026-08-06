import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL(
    "../node_modules/@modelcontextprotocol/server/LICENSE",
    import.meta.url
  )
);
const target = fileURLToPath(
  new URL(
    "../dist/third-party-licenses/modelcontextprotocol-server-LICENSE",
    import.meta.url
  )
);

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
