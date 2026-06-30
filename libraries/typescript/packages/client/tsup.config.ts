import { defineConfig } from "tsup";

export default defineConfig({
  // Object entries for the auth/ and react/ subpaths. Output paths mirror tsc's
  // rootDir:src layout (dist/auth/index.js, dist/react/index.js) so the emitted
  // .js and .d.ts line up and match the package.json "exports" map.
  entry: {
    index: "src/index.ts",
    "auth/index": "src/auth/index.ts",
    "auth/index-node": "src/auth/index-node.ts",
    "react/index": "src/react/index.ts",
  },
  format: ["esm", "cjs"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  // React is an optional peer dependency — never bundle it into the react
  // subpath (a second copy would break hooks).
  external: ["react", "react-dom"],
});
