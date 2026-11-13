import { createReadStream } from "node:fs";
import { lstat, opendir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createGzip } from "node:zlib";
import ignore, { type Ignore } from "ignore";
import { CommandError } from "../../core/errors.js";

const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  "__pycache__",
  ".venv",
  "venv",
  "coverage",
  ".nyc_output",
  ".output",
  "out",
  "target",
  ".mcp-use",
  ".manufact",
]);

/** Validate the compressed upload size before making a multipart request. */
export function assertManagedArchiveSize(sizeBytes: number): void {
  if (sizeBytes <= MAX_ARCHIVE_BYTES) return;
  throw new CommandError(
    "archive_too_large",
    `Project archive is ${(sizeBytes / 1024 / 1024).toFixed(2)} MB; the maximum is 80 MB.`,
    {
      sizeBytes,
      maxBytes: MAX_ARCHIVE_BYTES,
      nextSteps: [
        {
          description: "Exclude large generated files and retry",
          command: "mcp-use deploy --no-github",
        },
      ],
    }
  );
}

/** A `.gitignore` and the directory its patterns are relative to. */
interface IgnoreLevel {
  directory: string;
  rules: Ignore;
}

/**
 * Build a compressed source archive while respecting project ignore rules.
 *
 * Like Git, every `.gitignore` applies to the paths below its directory: the
 * ones in `projectRoot`'s ancestors up to the enclosing repository root, and
 * the ones in nested directories. A deeper file overrides a shallower one.
 */
export async function packProject(projectRoot: string): Promise<Buffer> {
  const ig = await ancestorIgnoreLevels(projectRoot);
  const gzip = createGzip();
  const chunks: Buffer[] = [];
  const collecting = (async () => {
    for await (const chunk of gzip) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
  })();
  try {
    await addDirectoryToArchive(gzip, projectRoot, "", ig);
    await writeArchiveChunk(gzip, Buffer.alloc(1024));
    gzip.end();
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : new Error(String(error)));
    await collecting.catch(() => {});
    throw error;
  }
  await collecting;
  return Buffer.concat(chunks);
}

async function loadGitIgnore(
  directory: string
): Promise<IgnoreLevel | undefined> {
  try {
    const content = await readFile(join(directory, ".gitignore"), "utf8");
    return { directory, rules: ignore({ ignorecase: false }).add(content) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return undefined;
  }
}

/**
 * Ignore files from the enclosing repository root down to `projectRoot`.
 * Outside a repository only `projectRoot`'s own `.gitignore` applies.
 */
async function ancestorIgnoreLevels(
  projectRoot: string
): Promise<IgnoreLevel[]> {
  const directories = [resolve(projectRoot)];
  for (let current = directories[0]!; ; ) {
    if (await exists(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) {
      directories.splice(1);
      break;
    }
    directories.push(parent);
    current = parent;
  }
  const levels = [];
  for (const directory of directories.reverse()) {
    const level = await loadGitIgnore(directory);
    if (level) levels.push(level);
  }
  return levels;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether the deepest matching rule ignores `absolutePath`. */
function isIgnored(
  levels: readonly IgnoreLevel[],
  absolutePath: string,
  isDirectory: boolean
): boolean {
  let ignored = false;
  for (const { directory, rules } of levels) {
    const path = relative(directory, absolutePath).replaceAll("\\", "/");
    if (path === "" || path.startsWith("..")) continue;
    const result = rules.test(isDirectory ? `${path}/` : path);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

async function addDirectoryToArchive(
  gzip: ReturnType<typeof createGzip>,
  projectRoot: string,
  relativeDirectory: string,
  inherited: readonly IgnoreLevel[]
): Promise<void> {
  const directoryPath =
    relativeDirectory === ""
      ? projectRoot
      : join(projectRoot, relativeDirectory);
  const own =
    relativeDirectory === "" ? undefined : await loadGitIgnore(directoryPath);
  const ig = own ? [...inherited, own] : inherited;
  const directory = await opendir(directoryPath);
  const entries = [];
  for await (const entry of directory) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath =
      relativeDirectory === ""
        ? entry.name
        : join(relativeDirectory, entry.name);
    if (!shouldArchive(relativePath)) continue;
    const posixPath = relativePath.replaceAll("\\", "/");
    const absolutePath = join(projectRoot, relativePath);
    if (
      (entry.isDirectory() || entry.isFile()) &&
      isIgnored(ig, absolutePath, entry.isDirectory())
    ) {
      continue;
    }
    const stats = await lstat(absolutePath);
    const archivePath = `app/${posixPath}`;
    const common = {
      path: archivePath,
      mode: stats.mode & 0o777,
      mtime: Math.floor(stats.mtimeMs / 1000),
    };

    if (stats.isDirectory()) {
      await writeTarHeader(gzip, { ...common, type: "directory", size: 0 });
      await addDirectoryToArchive(gzip, projectRoot, relativePath, ig);
    } else if (stats.isFile()) {
      await writeTarHeader(gzip, {
        ...common,
        type: "file",
        size: stats.size,
      });
      for await (const chunk of createReadStream(absolutePath)) {
        await writeArchiveChunk(gzip, chunk as Buffer);
      }
      await writeTarPadding(gzip, stats.size);
    } else if (stats.isSymbolicLink()) {
      // Managed uploads intentionally omit links. A link can escape the project
      // root or point back into an excluded secret/dependency directory, and
      // extraction behavior differs between archive runtimes.
      continue;
    }
  }
}

function shouldArchive(relativePath: string): boolean {
  const segments = relativePath.split(/[/\\]/).filter(Boolean);
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) {
    return false;
  }
  const filename = segments.at(-1) ?? "";
  if (
    filename === ".DS_Store" ||
    filename === "Thumbs.db" ||
    filename === "desktop.ini"
  ) {
    return false;
  }
  return !filename.startsWith(".env");
}

interface TarEntry {
  path: string;
  mode: number;
  mtime: number;
  size: number;
  type: "file" | "directory" | "symlink";
  linkPath?: string;
}

async function writeTarHeader(
  gzip: ReturnType<typeof createGzip>,
  entry: TarEntry
): Promise<void> {
  const pax: Record<string, string> = {};
  const pathFields = splitUstarPath(entry.path);
  if (pathFields === undefined || !isAscii(entry.path)) {
    pax["path"] = entry.path;
  }
  if (
    entry.linkPath !== undefined &&
    (Buffer.byteLength(entry.linkPath) > 100 || !isAscii(entry.linkPath))
  ) {
    pax["linkpath"] = entry.linkPath;
  }
  if (Object.keys(pax).length > 0) {
    const body = Buffer.from(
      Object.entries(pax)
        .map(([key, value]) => paxRecord(key, value))
        .join("")
    );
    await writeArchiveChunk(
      gzip,
      createTarHeader({
        path: "PaxHeader/entry",
        mode: 0o644,
        mtime: entry.mtime,
        size: body.length,
        type: "pax",
      })
    );
    await writeArchiveChunk(gzip, body);
    await writeTarPadding(gzip, body.length);
  }
  await writeArchiveChunk(
    gzip,
    createTarHeader({
      ...entry,
      path: pathFields === undefined ? "app/PaxEntry" : entry.path,
      ...(entry.linkPath !== undefined &&
      (Buffer.byteLength(entry.linkPath) > 100 || !isAscii(entry.linkPath))
        ? { linkPath: "PaxLink" }
        : {}),
    })
  );
}

function createTarHeader(
  entry: Omit<TarEntry, "type"> & {
    type: TarEntry["type"] | "pax";
  }
): Buffer {
  const header = Buffer.alloc(512);
  const pathFields = splitUstarPath(entry.path) ?? {
    name: entry.path.slice(-100),
    prefix: "",
  };
  writeString(header, pathFields.name, 0, 100);
  writeOctal(header, entry.mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, entry.size, 124, 12);
  writeOctal(header, entry.mtime, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] =
    entry.type === "directory"
      ? 0x35
      : entry.type === "symlink"
        ? 0x32
        : entry.type === "pax"
          ? 0x78
          : 0x30;
  if (entry.linkPath !== undefined) {
    writeString(header, entry.linkPath, 157, 100);
  }
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, "mcp-use", 265, 32);
  writeString(header, "mcp-use", 297, 32);
  writeString(header, pathFields.prefix, 345, 155);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encoded = checksum.toString(8).padStart(6, "0");
  header.write(encoded, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitUstarPath(
  path: string
): { name: string; prefix: string } | undefined {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let separator = path.lastIndexOf("/"); separator > 0; ) {
    const prefix = path.slice(0, separator);
    const name = path.slice(separator + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
    separator = path.lastIndexOf("/", separator - 1);
  }
  return undefined;
}

function paxRecord(key: string, value: string): string {
  const content = `${key}=${value}\n`;
  let length = Buffer.byteLength(content) + 3;
  while (true) {
    const record = `${length} ${content}`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return record;
    length = actual;
  }
}

function isAscii(value: string): boolean {
  return Buffer.byteLength(value) === value.length;
}

function writeString(
  target: Buffer,
  value: string,
  offset: number,
  length: number
): void {
  target.write(value, offset, length, "utf8");
}

function writeOctal(
  target: Buffer,
  value: number,
  offset: number,
  length: number
): void {
  const encoded = Math.max(0, value)
    .toString(8)
    .padStart(length - 1, "0")
    .slice(-(length - 1));
  target.write(encoded, offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

async function writeTarPadding(
  gzip: ReturnType<typeof createGzip>,
  size: number
): Promise<void> {
  const padding = (512 - (size % 512)) % 512;
  if (padding > 0) await writeArchiveChunk(gzip, Buffer.alloc(padding));
}

async function writeArchiveChunk(
  gzip: ReturnType<typeof createGzip>,
  chunk: Buffer
): Promise<void> {
  if (gzip.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      gzip.off("drain", onDrain);
      gzip.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    gzip.once("drain", onDrain);
    gzip.once("error", onError);
  });
}

/** Attach a source archive to its multipart upload. */
export function appendArchive(form: FormData, archive: Buffer): void {
  form.set(
    "sourceFile",
    new Blob([new Uint8Array(archive)], { type: "application/gzip" }),
    "source.tar.gz"
  );
}
