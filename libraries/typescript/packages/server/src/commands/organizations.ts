import { parseArgs } from "node:util";

import {
  CloudApi,
  readCloudConfig,
  resolveOrganization,
  writeCloudConfig,
} from "./cloud-api.js";
import { printResult, reportError, UsageError, wantsJson } from "./shared.js";

/** Run the `mcp-use org` command family. */
export async function runOrganizations(
  argv: readonly string[]
): Promise<number> {
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

    const selector = argv[1];
    if (selector === undefined || argv.length !== 2) {
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
