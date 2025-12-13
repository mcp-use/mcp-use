// Browser stub for fs module
// This stub is used when building for the browser to avoid bundling Node.js-specific code

export function readFileSync() {
  throw new Error("fs.readFileSync is not available in browser environment");
}

export function writeFileSync() {
  throw new Error("fs.writeFileSync is not available in browser environment");
}

export function existsSync() {
  return false;
}

export function readFile() {
  throw new Error("fs.readFile is not available in browser environment");
}

export function writeFile() {
  throw new Error("fs.writeFile is not available in browser environment");
}

export function mkdir() {
  throw new Error("fs.mkdir is not available in browser environment");
}

export function readdir() {
  throw new Error("fs.readdir is not available in browser environment");
}

export function stat() {
  throw new Error("fs.stat is not available in browser environment");
}

export function unlink() {
  throw new Error("fs.unlink is not available in browser environment");
}

export function rmdir() {
  throw new Error("fs.rmdir is not available in browser environment");
}

export default {
  readFileSync,
  writeFileSync,
  existsSync,
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  unlink,
  rmdir,
};
