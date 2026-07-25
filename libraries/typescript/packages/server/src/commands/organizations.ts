import { parseArgs } from "node:util";

import {
  CloudApi,
  readCloudConfig,
  resolveOrganization,
  writeCloudConfig,
} from "./cloud-api.js";
import { printResult, reportError, UsageError, wantsJson } from "./shared.js";

const HELP = `Usage: mcp-use org <command> [options]

Manage the active cloud organization.

Commands:
  list                  List memberships and mark the active organization
  current               Show the active organization
  use <id-or-slug>      Save an active organization locally and best-effort
                        update the account default

Options:
  --json                Emit one machine-readable result or error
  -h, --help            Show help for this command or subcommand

Examples:
  mcp-use org list
  mcp-use org current --json
  mcp-use org use acme --json

Exit codes:
  0  Success or help
  2  Invalid arguments or no active organization
  1  Authentication or API failure`;

const SUBCOMMAND_HELP: Record<string, string> = {
  list: `Usage: mcp-use org list [--json]\n\nList organization memberships. The active entry is marked with * in human output.\n\nOptions:\n  --json      Emit an array\n  -h, --help  Show this help`,
  current: `Usage: mcp-use org current [--json]\n\nShow the active organization.\n\nOptions:\n  --json      Emit an organization object\n  -h, --help  Show this help`,
  use: `Usage: mcp-use org use <id-or-slug> [--json]\n\nSelect and persist the active organization.\n\nOptions:\n  --json      Emit the selected organization\n  -h, --help  Show this help`,
};

/** Run the `mcp-use org` command family. */
export async function runOrganizations(
  argv: readonly string[]
): Promise<number> {
  const helpIndex = argv.findIndex(
    (token) => token === "--help" || token === "-h"
  );
  if (helpIndex !== -1) {
    process.stdout.write(`${SUBCOMMAND_HELP[argv[0] ?? ""] ?? HELP}\n`);
    return 0;
  }
  const json = wantsJson(argv);
  try {
    const subcommand = argv[0];
    if (!["list", "current", "use"].includes(subcommand ?? "")) {
      throw new UsageError("Usage: mcp-use org <list|current|use>");
    }
    const api = await CloudApi.create();
    const identity = await api.identity();
    const config = await readCloudConfig();

    if (subcommand === "list") {
      parseJsonOnly(argv.slice(1));
      const organizations = identity.organizations.map((organization) => ({
        ...organization,
        active:
          organization.id ===
          (config.orgId ?? identity.defaultOrganizationId ?? undefined),
      }));
      printResult(
        organizations,
        json,
        organizations
          .map(
            (organization) =>
              `${organization.active ? "* " : "  "}${organization.name} (${organization.slug ?? organization.id}) [${organization.role}]`
          )
          .join("\n") || "No organizations."
      );
      return 0;
    }

    if (subcommand === "current") {
      parseJsonOnly(argv.slice(1));
      const organization =
        identity.organizations.find(
          (item) => item.id === (config.orgId ?? identity.defaultOrganizationId)
        ) ?? null;
      if (organization === null) {
        throw new UsageError(
          "No active organization. Run `mcp-use org use <id-or-slug>`."
        );
      }
      printResult(
        organization,
        json,
        `${organization.name} (${organization.slug ?? organization.id})`
      );
      return 0;
    }

    const normalized = argv.filter((token) => token !== "--json");
    const selector = normalized[1];
    if (selector === undefined || normalized.length !== 2) {
      throw new UsageError("Usage: mcp-use org use <id-or-slug>");
    }
    const organization = resolveOrganization(identity.organizations, selector);
    await writeCloudConfig({
      ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
      orgId: organization.id,
      orgName: organization.name,
      ...(organization.slug !== null ? { orgSlug: organization.slug } : {}),
    });
    try {
      await api.setDefaultOrganization(organization.id);
    } catch {
      // Local selection is authoritative; account default update is best-effort.
    }
    printResult(
      organization,
      json,
      `Using ${organization.name} (${organization.slug ?? organization.id}).`
    );
    return 0;
  } catch (error) {
    return reportError(
      error instanceof TypeError ? new UsageError(error.message) : error,
      json
    );
  }
}

function parseJsonOnly(argv: readonly string[]): void {
  parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: { json: { type: "boolean" } },
  });
}
