import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { describe, expect } from "vitest";
import { test } from "../helpers/cli-test.js";
import { SIGNED_IN, signIn } from "../helpers/cloud-auth.js";

const exec = promisify(execFile);

describe("deployment file safety", () => {
  test("a Git configuration error cannot silently include parent-ignored files", async ({
    cli,
  }) => {
    await exec("git", ["init", "-q"], { cwd: cli.cwd });
    await mkdir(join(cli.cwd, "app"));
    await writeFile(join(cli.cwd, ".gitignore"), "app/private.txt\n");
    await writeFile(join(cli.cwd, "app", "private.txt"), "private fixture");
    await writeFile(join(cli.cwd, "app", "server.py"), "pass\n");
    await writeFile(join(cli.cwd, ".git", "config"), "invalid configuration\n");

    const result = await cli.run(["deploy", "app", "--dry-run", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ error: { code: "git_error" } });
  });

  test("a damaged Git directory cannot silently disable its ignore rules", async ({
    cli,
  }) => {
    await exec("git", ["init", "-q"], { cwd: cli.cwd });
    await writeFile(join(cli.cwd, "server.py"), "pass\n");
    await rm(join(cli.cwd, ".git", "HEAD"));

    const result = await cli.run(["deploy", "--dry-run", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ error: { code: "git_error" } });
  });

  test("Git being unavailable still permits the project's own ignore rules", async ({
    cli,
  }) => {
    await writeFile(join(cli.cwd, ".gitignore"), "private.txt\n");
    await writeFile(join(cli.cwd, "private.txt"), "private fixture");
    await writeFile(join(cli.cwd, "server.py"), "pass\n");

    const result = await cli.run(["deploy", "--dry-run", "--json"], {
      env: { PATH: cli.cwd },
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      files: [{ path: ".gitignore" }, { path: "server.py" }],
      fileCount: 2,
    });
  });

  test("untracked nested repositories honor exclusions and re-inclusions with normalized paths", async ({
    cli,
  }) => {
    await exec("git", ["init", "-q"], { cwd: cli.cwd });
    const nested = join(cli.cwd, "nested");
    await mkdir(nested);
    await exec("git", ["init", "-q"], { cwd: nested });
    await writeFile(
      join(cli.cwd, ".manufactignore"),
      "nested/drop.txt\n!nested/restore.txt\n"
    );
    await writeFile(join(nested, ".gitignore"), "restore.txt\n");
    for (const name of ["drop.txt", "keep.txt", "restore.txt"])
      await writeFile(join(nested, name), "fixture");

    const result = await cli.run(["deploy", "--dry-run", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      files: [
        { path: ".manufactignore" },
        { path: "nested/.gitignore" },
        { path: "nested/keep.txt" },
        { path: "nested/restore.txt" },
      ],
      fileCount: 4,
    });
  });

  test.for([
    ["missing", []],
    [".", ["--root-dir", "../outside"]],
    [".", ["--root-dir", "missing"]],
    [".", ["--dockerfile", join(process.cwd(), "Dockerfile")]],
  ] as const)(
    "dry-run validates source paths: %s %j",
    async ([path, flags], { cli }) => {
      await writeFile(join(cli.cwd, "server.py"), "pass\n");
      const result = await cli.run([
        "deploy",
        path,
        "--dry-run",
        "--json",
        ...flags,
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.json).toMatchObject({ error: { code: "usage_error" } });
    }
  );

  test("empty uploads name the credential files and symbolic links they skipped", async ({
    cli,
  }) => {
    await writeFile(join(cli.cwd, ".env.synthetic"), "SYNTHETIC=1\n");
    await writeFile(join(cli.cwd, "fixture.pem"), "synthetic fixture");
    if (process.platform !== "win32")
      await symlink("fixture.pem", join(cli.cwd, "alias"));

    const result = await cli.run(["deploy", "--dry-run", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ error: { code: "nothing_to_upload" } });
    expect(result.stdout).toContain(".env.synthetic");
    expect(result.stdout).toContain("fixture.pem");
    if (process.platform !== "win32") expect(result.stdout).toContain("alias");
  });

  test("a tracked directory replaced by a link cannot upload outside-project contents", async ({
    cli,
    cloud,
  }) => {
    signIn(cloud);
    await exec("git", ["init", "-q"], { cwd: cli.cwd });
    await mkdir(join(cli.cwd, "nested"));
    await writeFile(join(cli.cwd, "nested", "data.txt"), "tracked fixture");
    await exec("git", ["add", "nested/data.txt"], { cwd: cli.cwd });
    await rm(join(cli.cwd, "nested"), { recursive: true });
    const outside = join(cli.home, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "data.txt"), "outside-project-content");
    await symlink(outside, join(cli.cwd, "nested"), "junction");
    await writeFile(join(cli.cwd, "server.py"), "print('included-server')\n");
    cloud.on("POST", "/api/v1/servers", {
      body: { server: { id: "srv_1", slug: "safe" }, deploymentId: "dep_1" },
    });

    const result = await cli.run(["deploy", "--no-github", "--no-wait"], {
      env: SIGNED_IN,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Skipped symbolic links: nested");
    const requests = cloud.requestsTo("POST", "/api/v1/servers");
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const boundary =
      request.headers["content-type"]!.match(/boundary=(.+)$/)![1]!;
    const start = request.rawBody.indexOf("\r\n\r\n") + 4;
    const end = request.rawBody.indexOf(`\r\n--${boundary}`, start);
    const contents = gunzipSync(
      request.rawBody.subarray(start, end)
    ).toString();
    expect(contents).toContain("included-server");
    expect(contents.includes("outside-project-content")).toBe(false);
  });

  test("Unicode paths fail explicitly before an incompatible backend can truncate the source", async ({
    cli,
  }) => {
    await writeFile(join(cli.cwd, "café.txt"), "fixture");
    await writeFile(join(cli.cwd, "server.py"), "pass\n");
    const result = await cli.run(["deploy", "--dry-run", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      error: { code: "unsupported_archive_path" },
    });
    expect(result.stdout).toContain("café.txt");
  });

  test("file sizes round into the next unit at the display boundary", async ({
    cli,
  }) => {
    const file = join(cli.cwd, "payload.bin");
    await writeFile(file, "");
    await truncate(file, 1048575);
    const result = await cli.run(["deploy", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("payload.bin  1.0 MB");
  });

  test("oversized sources fail without announcing or sending an upload", async ({
    cli,
    cloud,
  }) => {
    signIn(cloud);
    await writeFile(
      join(cli.cwd, "payload.bin"),
      randomBytes(81 * 1024 * 1024)
    );
    const result = await cli.run(["deploy", "--no-github", "--no-wait"], {
      env: SIGNED_IN,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("maximum is 80 MB");
    expect(result.stderr).not.toContain("Uploading");
    expect(cloud.requestsTo("POST", "/api/v1/servers")).toHaveLength(0);
  });
});
