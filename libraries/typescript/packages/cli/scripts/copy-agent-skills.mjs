import { cp, mkdir } from "node:fs/promises";

// Ship the repository's agent skills with the CLI so installation uses the
// installed release's guidance and does not require a GitHub download.
const source = new URL("../../../../../skills/", import.meta.url);
const target = new URL("../dist/agent-skills/", import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
