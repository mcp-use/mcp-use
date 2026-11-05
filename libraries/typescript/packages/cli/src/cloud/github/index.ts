import { parseCommandArgs, runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { connectCloud } from "../api/client.js";

const USAGE = "mcp-use github <connect|installations|repos> [options]";
const HELP = `Usage: ${USAGE}

Commands:
  connect                 Print the GitHub App installation URL
  installations           List connected GitHub installations
  repos                   List repositories available to an installation

Options:
  --org <id-or-slug>       Organization override (or MANUFACT_ORG)
  --installation <id>     GitHub installation for repos; auto-selected if unique
  --page <n>              Repository page (default: 1)
  --limit <n>             Repositories per page, 1-100 (default: 50)
  --json                  Emit one JSON result or error
  -h, --help              Show this help`;

function positiveInteger(
  value: string | undefined,
  fallback: number,
  flag: string,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > max
  )
    throw new UsageError(`Pass ${flag} as an integer from 1 to ${max}.`);
  return number;
}

/** Inspect GitHub App access or print an installation URL. */
export async function runGithub(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, async (output) => {
    const command = argv[0];
    if (!["connect", "installations", "repos"].includes(command ?? ""))
      throw new UsageError(`Usage: ${USAGE}`);
    const { values } = parseCommandArgs(argv.slice(1), {
      options: {
        org: { type: "string" },
        json: { type: "boolean" },
        ...(command === "repos"
          ? {
              installation: { type: "string" as const },
              page: { type: "string" as const },
              limit: { type: "string" as const },
            }
          : {}),
      },
      positionals: 0,
      usage: USAGE,
    });
    const page = positiveInteger(
      typeof values.page === "string" ? values.page : undefined,
      1,
      "--page"
    );
    const perPage = positiveInteger(
      typeof values.limit === "string" ? values.limit : undefined,
      50,
      "--limit",
      100
    );
    const cloud = await connectCloud({
      organization: values.org ?? process.env["MANUFACT_ORG"],
    });
    if (command === "connect") {
      const result = await cloud.call(
        cloud.client.GET("/api/v1/github/connect-url", {
          params: { query: { organizationId: cloud.organization.id } },
        })
      );
      output.result(result, result.url);
      return;
    }
    const list = async () =>
      cloud.call(
        cloud.client.GET("/api/v1/github/installations", {
          params: { query: { organizationId: cloud.organization.id } },
        })
      );
    if (command === "installations") {
      const result = await list();
      output.result(
        result,
        result.installations
          .map(
            (item) =>
              `${item.installationId}\t${item.account?.login ?? "unknown"}\t${item.isActive ? "active" : "inactive"}`
          )
          .join("\n") || "No GitHub installations."
      );
      return;
    }
    let installationId =
      typeof values.installation === "string" ? values.installation : undefined;
    if (installationId === undefined) {
      const installations = (await list()).installations.filter(
        (item) => item.isActive
      );
      if (installations.length !== 1)
        throw new UsageError(
          "Pass --installation <id>; use mcp-use github installations --json to list installations."
        );
      installationId = installations[0]!.installationId;
    }
    const result = await cloud.call(
      cloud.client.GET("/api/v1/github/installations/{installationId}/repos", {
        params: { path: { installationId }, query: { page, perPage } },
      })
    );
    output.result(
      result,
      result.repos
        .map(
          (repo) =>
            `${repo.fullName}\t${repo.private ? "private" : "public"}\t${repo.defaultBranch ?? ""}`
        )
        .join("\n") || "No repositories."
    );
  });
}
