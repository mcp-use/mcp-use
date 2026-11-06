/**
 * `mcp-use link`: link a project directory to a Manufact Cloud server by
 * writing `.manufact/project.json`. Later commands run in that directory act
 * on the linked server without `--server`.
 */
import { createInterface } from "node:readline/promises";

import { parseCommandArgs, runCommand } from "../../core/command.js";
import { CommandError } from "../../core/errors.js";
import {
  ignoreLinkDirectory,
  linkFilePath,
  writeProjectLink,
} from "./link-file.js";
import {
  connectProject,
  PROJECT_OPTIONS,
  type ResolvedProject,
} from "./resolve.js";

const USAGE =
  "mcp-use link [--server <id-or-slug>] [--org <id-or-slug>] [--path <dir>] [--json]";

const HELP = `Usage: ${USAGE}

Link this project to a Manufact Cloud server. Writes .manufact/project.json
in the project root and adds .manufact/ to the project's .gitignore. Commands
run in the project then act on that server without --server.

Options:
  --server <id-or-slug>  Server to link. Default: MANUFACT_SERVER, then the
                         current link. In a terminal, you can pick from a list.
  --org <id-or-slug>     Organization to look the server up in. Default:
                         MANUFACT_ORG, then the linked organization, then the
                         active organization
  --path <dir>           Project root (default: current directory)
  --json                 Emit one JSON result or error
  -h, --help             Show this help

Exit codes:
  0  Linked, or help
  1  The server was not found, or Cloud failed
  2  Invalid arguments, or no server given without a terminal`;

const LIST_SERVERS = {
  description: "List servers",
  command: "mcp-use servers list --json",
};

/** Run `mcp-use link`. */
export async function runLink(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, async (output) => {
    const { values } = parseCommandArgs(argv, {
      options: { ...PROJECT_OPTIONS, json: { type: "boolean" } },
      positionals: 0,
      usage: USAGE,
    });
    const interactive = !output.json && process.stdin.isTTY === true;
    const { cloud, server, root } = await connectProject(values, {
      pickServer: interactive ? pickServer : undefined,
    });
    const found = await cloud.call(
      cloud.client.GET("/api/v1/servers/{id}", {
        params: { path: { id: server } },
      }),
      { notFound: { code: "server_not_found", nextSteps: [LIST_SERVERS] } }
    );
    await writeProjectLink(root, {
      orgId: found.organizationId,
      serverId: found.id,
    });
    await ignoreLinkDirectory(root);
    const linkFile = linkFilePath(root);
    output.result(
      {
        orgId: found.organizationId,
        serverId: found.id,
        serverSlug: found.slug,
        serverName: found.name,
        linkFile,
      },
      `Linked to ${found.name ?? found.slug ?? found.id} (${found.id}).\nSaved ${linkFile}.`
    );
  });
}

/** Ask which of the organization's servers to link. Terminal only. */
async function pickServer(cloud: ResolvedProject["cloud"]): Promise<string> {
  const page = await cloud.call(
    cloud.client.GET("/api/v1/servers", {
      params: { query: { organizationId: cloud.organization.id, limit: 100 } },
    })
  );
  if (page.items.length === 0) {
    throw new CommandError(
      "no_servers",
      `${cloud.organization.name} has no servers to link.`,
      undefined,
      [{ description: "Deploy this project", command: "mcp-use deploy" }]
    );
  }
  page.items.forEach((item, index) => {
    process.stderr.write(
      `${index + 1}. ${item.name ?? item.slug ?? item.id} (${item.id})\n`
    );
  });
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    for (;;) {
      const answer = await prompt.question(
        `Server to link [1-${page.items.length}]: `
      );
      const chosen = page.items[Number(answer.trim()) - 1];
      if (chosen !== undefined) return chosen.id;
    }
  } finally {
    prompt.close();
  }
}
