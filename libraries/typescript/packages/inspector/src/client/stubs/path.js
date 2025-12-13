// Browser stub for path module
// Provides minimal path operations for browser environment

export function join(...paths) {
  // Simple join implementation for browser
  return paths
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

export function resolve(...paths) {
  // In browser, just join paths
  return join(...paths);
}

export function dirname(filepath) {
  const parts = filepath.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

export function basename(filepath, ext) {
  const parts = filepath.split("/");
  let name = parts[parts.length - 1] || "";
  if (ext && name.endsWith(ext)) {
    name = name.slice(0, -ext.length);
  }
  return name;
}

export function extname(filepath) {
  const name = basename(filepath);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}

export function normalize(filepath) {
  return filepath.replace(/\/+/g, "/");
}

export function isAbsolute(filepath) {
  return filepath.startsWith("/");
}

export function parse(filepath) {
  // Parse a path string into an object with root, dir, base, ext, and name
  const root = filepath.startsWith("/") ? "/" : "";
  const dir = dirname(filepath);
  const base = basename(filepath);
  const ext = extname(filepath);
  const name = ext ? base.slice(0, -ext.length) : base;

  return {
    root,
    dir,
    base,
    ext,
    name,
  };
}

export const sep = "/";
export const delimiter = ":";

export default {
  join,
  resolve,
  dirname,
  basename,
  extname,
  normalize,
  isAbsolute,
  parse,
  sep,
  delimiter,
};
