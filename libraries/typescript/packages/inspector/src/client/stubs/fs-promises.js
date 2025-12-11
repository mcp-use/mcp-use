// Browser stub for fs/promises module
// This stub is used when building for the browser to avoid bundling Node.js-specific code

export async function readFile() {
  throw new Error(
    "fs.promises.readFile is not available in browser environment"
  );
}

export async function writeFile() {
  throw new Error(
    "fs.promises.writeFile is not available in browser environment"
  );
}

export async function mkdir() {
  throw new Error("fs.promises.mkdir is not available in browser environment");
}

export async function readdir() {
  throw new Error(
    "fs.promises.readdir is not available in browser environment"
  );
}

export async function stat() {
  throw new Error("fs.promises.stat is not available in browser environment");
}

export async function unlink() {
  throw new Error("fs.promises.unlink is not available in browser environment");
}

export async function rmdir() {
  throw new Error("fs.promises.rmdir is not available in browser environment");
}

export async function access() {
  throw new Error("fs.promises.access is not available in browser environment");
}

export async function copyFile() {
  throw new Error(
    "fs.promises.copyFile is not available in browser environment"
  );
}

export async function rename() {
  throw new Error("fs.promises.rename is not available in browser environment");
}

export default {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  unlink,
  rmdir,
  access,
  copyFile,
  rename,
};
