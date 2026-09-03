const wildcard = /[*?[\]{}]/u;

function normalizedPath(value) {
  return value.replace(/^\.\//u, "").replace(/\/$/u, "");
}

function entryPointPaths(value, paths = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("./") && !wildcard.test(value)) {
      paths.add(normalizedPath(value));
    }
    return paths;
  }
  if (Array.isArray(value)) {
    for (const item of value) entryPointPaths(item, paths);
    return paths;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) entryPointPaths(item, paths);
  }
  return paths;
}

export function requiredPackedEntries(manifest) {
  const exact = new Set();
  const prefixes = new Set();

  for (const field of ["main", "module", "types"]) {
    const value = manifest[field];
    if (typeof value === "string" && !wildcard.test(value)) {
      exact.add(normalizedPath(value));
    }
  }
  entryPointPaths(manifest.bin, exact);
  entryPointPaths(manifest.exports, exact);

  for (const value of manifest.files ?? []) {
    if (typeof value !== "string" || wildcard.test(value)) continue;
    const path = normalizedPath(value);
    if (path) prefixes.add(path);
  }

  return { exact: [...exact].sort(), prefixes: [...prefixes].sort() };
}

export function packedArtifactErrors(manifest, files) {
  const paths = new Set(files.map(({ path }) => normalizedPath(path)));
  const { exact, prefixes } = requiredPackedEntries(manifest);
  const errors = [];

  for (const path of exact) {
    if (!paths.has(path)) errors.push(`missing entry point ${path}`);
  }
  for (const prefix of prefixes) {
    if (
      ![...paths].some(
        (path) => path === prefix || path.startsWith(`${prefix}/`)
      )
    ) {
      errors.push(`files entry ${prefix} matched no packed files`);
    }
  }
  return errors;
}

export function packedFilesFromNpmPackJson(output) {
  const parsed = JSON.parse(output);
  const packed = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!packed?.files) {
    throw new Error("npm pack returned no file list");
  }
  return packed.files;
}
