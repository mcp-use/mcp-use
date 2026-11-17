import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { CommandError } from "../../core/errors.js";
import {
  comparePaths,
  MANUFACT_IGNORE_FILE,
  selectProjectFiles,
  type ProjectFile,
  type ProjectFileSelection,
} from "./files.js";

const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;

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
          description:
            "List the files the upload includes, then exclude large ones in .manufactignore",
          command: "mcp-use deploy --dry-run",
        },
      ],
    }
  );
}

/** Format a byte count for people, e.g. `3.1 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (Number(value.toFixed(1)) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Describe an upload in a few lines: how much it sends and which files the
 * built-in exclusions left out.
 */
export function describeUpload({ archive, selection }: PackedProject): string {
  const count = selection.files.length;
  const lines = [
    `Uploading ${count} ${count === 1 ? "file" : "files"} (${formatBytes(archive.byteLength)} compressed)`,
  ];
  return [...lines, ...describeSkipped(selection)].join("\n");
}

function describeSkipped(selection: ProjectFileSelection): string[] {
  const lines: string[] = [];
  const { sensitive, symlinks } = selection.skipped;
  if (sensitive.length > 0)
    lines.push(`Skipped credential files: ${sensitive.join(", ")}`);
  if (symlinks.length > 0)
    lines.push(`Skipped symbolic links: ${symlinks.join(", ")}`);
  return lines;
}

/** A packed upload and the selection it was built from. */
interface PackedProject {
  archive: Buffer;
  selection: ProjectFileSelection;
}

/** Build a compressed source archive of the files `selectProjectFiles` picks. */
export async function packProject(projectRoot: string): Promise<PackedProject> {
  const selection = await selectProjectFiles(projectRoot);
  if (selection.files.length === 0)
    throw new CommandError(
      "nothing_to_upload",
      [
        `No files to upload from ${projectRoot}. Every file is ignored by Git, ${MANUFACT_IGNORE_FILE}, or the built-in exclusions.`,
        ...describeSkipped(selection),
      ].join("\n")
    );
  // Bun's archive reader currently stops at non-ASCII paths (even in valid
  // standard tar archives), silently losing every subsequent source file.
  // Fail before uploading until the managed backend can read those paths.
  const unsupported = selection.files.filter((file) => !isAscii(file.path));
  if (unsupported.length > 0)
    throw new CommandError(
      "unsupported_archive_path",
      `The managed backend cannot currently read non-ASCII archive paths: ${unsupported.map((file) => file.path).join(", ")}. Rename these files or exclude them in ${MANUFACT_IGNORE_FILE} before deploying.`
    );
  const gzip = createGzip();
  const chunks: Buffer[] = [];
  const collecting = (async () => {
    for await (const chunk of gzip) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
  })();
  try {
    await addFilesToArchive(gzip, projectRoot, selection.files);
    await writeArchiveChunk(gzip, Buffer.alloc(1024));
    gzip.end();
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : new Error(String(error)));
    await collecting.catch(() => {});
    throw error;
  }
  await collecting;
  return { archive: Buffer.concat(chunks), selection };
}

/** Write each file under `app/`, preceded by entries for its directories. */
async function addFilesToArchive(
  gzip: ReturnType<typeof createGzip>,
  projectRoot: string,
  files: readonly ProjectFile[]
): Promise<void> {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.path.split("/");
    for (let depth = 1; depth < segments.length; depth++)
      directories.add(segments.slice(0, depth).join("/"));
  }
  const entries: Array<{ path: string; file?: ProjectFile }> = [
    ...[...directories].map((path) => ({ path })),
    ...files.map((file) => ({ path: file.path, file })),
  ].sort((left, right) => comparePaths(left.path, right.path));

  for (const { path, file } of entries) {
    const absolutePath = join(projectRoot, path);
    if (file === undefined) {
      const stats = await lstat(absolutePath);
      await writeTarHeader(gzip, {
        path: `app/${path}`,
        mode: stats.mode & 0o777,
        mtime: Math.floor(stats.mtimeMs / 1000),
        type: "directory",
        size: 0,
      });
      continue;
    }
    await writeTarHeader(gzip, {
      path: `app/${path}`,
      mode: file.mode,
      mtime: Math.floor(file.mtimeMs / 1000),
      type: "file",
      size: file.size,
    });
    let written = 0;
    for await (const chunk of createReadStream(absolutePath, {
      end: Math.max(0, file.size - 1),
    })) {
      if (file.size === 0) break;
      written += (chunk as Buffer).length;
      await writeArchiveChunk(gzip, chunk as Buffer);
    }
    if (written !== file.size)
      throw new CommandError(
        "source_changed",
        `${path} changed while it was being packed. Retry the deploy.`
      );
    await writeTarPadding(gzip, file.size);
  }
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
