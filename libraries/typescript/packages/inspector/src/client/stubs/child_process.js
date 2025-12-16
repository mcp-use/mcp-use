// Browser stub for child_process module
// This stub is used when building for the browser to avoid bundling Node.js-specific code

export function spawn() {
  throw new Error(
    "child_process.spawn is not available in browser environment"
  );
}

export function exec() {
  throw new Error("child_process.exec is not available in browser environment");
}

export function execFile() {
  throw new Error(
    "child_process.execFile is not available in browser environment"
  );
}

export function fork() {
  throw new Error("child_process.fork is not available in browser environment");
}

export function execSync() {
  throw new Error(
    "child_process.execSync is not available in browser environment"
  );
}

export function spawnSync() {
  throw new Error(
    "child_process.spawnSync is not available in browser environment"
  );
}

export function execFileSync() {
  throw new Error(
    "child_process.execFileSync is not available in browser environment"
  );
}

export default {
  spawn,
  exec,
  execFile,
  fork,
  execSync,
  spawnSync,
  execFileSync,
};
