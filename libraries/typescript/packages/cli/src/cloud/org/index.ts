import { plain, fields } from "../../core/format.js";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { callerFor, createCloudClient } from "../api/client.js";
import {
  chooseOrganization,
  findOrganization,
  listOrganizations,
} from "../auth/account.js";
import { readAuth, requireCredential, updateAuth } from "../auth/store.js";
import { cloudFor, parseCloudArgs } from "../options.js";
import { cloudHelp } from "../help.js";
import { runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";

const COMMANDS = ["list", "current", "use", "create", "update"];

/** Manage organization selection, identity and branding. */
export async function runOrganizations(
  argv: readonly string[]
): Promise<number> {
  const operation = argv[0];
  if (operation === "members") {
    const { runOrgMembers } = await import("./members.js");
    return runOrgMembers(argv.slice(1));
  }
  if (operation === "invites") {
    const { runOrgInvites } = await import("./invites.js");
    return runOrgInvites(argv.slice(1));
  }
  const help = cloudHelp("org", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    if (!COMMANDS.includes(operation ?? ""))
      throw new UsageError(
        "Usage: mcp-use org <list|current|use|create|update>"
      );
    const { values, positionals } = parseCloudArgs(
      argv.slice(1),
      {
        name: { type: "string" },
        slug: { type: "string" },
        logo: { type: "string" },
      },
      `mcp-use org ${operation} [options]`,
      operation === "use" || operation === "create" ? 1 : 0
    );
    if (
      values.slug !== undefined &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)
    )
      throw new UsageError(
        "--slug must use lowercase letters, numbers and hyphens."
      );
    if (
      operation === "update" &&
      values.name === undefined &&
      values.slug === undefined &&
      values.logo === undefined
    )
      throw new UsageError(
        "Pass --name, --slug or --logo to update the organization."
      );
    if (
      operation !== "update" &&
      (values.name !== undefined || values.logo !== undefined)
    )
      throw new UsageError("--name and --logo are available on org update.");
    const logo = values.logo ? await readFile(values.logo) : undefined;
    const { apiKey } = await requireCredential();
    const api = {
      client: createCloudClient({ apiKey }),
      call: callerFor(apiKey),
    };
    const saved = await readAuth();
    if (operation === "create") {
      const name = positionals[0]!;
      const slug =
        values.slug ??
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      if (!slug)
        throw new UsageError(
          "Pass --slug for a name without URL-safe letters or numbers."
        );
      const created = await api.call(
        api.client.POST("/api/auth/organization/create", {
          body: { name, slug },
        })
      );
      output.result(created, `Created ${created.name} (${created.slug}).`);
      return;
    }
    if (operation === "list" || operation === "use") {
      const organizations = await listOrganizations(api);
      if (operation === "list") {
        const active = await chooseOrganization(api, organizations, {
          storedId: saved.orgId,
        });
        const result = organizations.map((item) => ({
          ...item,
          active: item.id === active?.id,
        }));
        output.result(
          result,
          result
            .map(
              (item) =>
                `${item.active ? "*" : " "} ${item.name} (${item.slug ?? item.id}) [${item.role}]`
            )
            .join("\n") || "No organizations."
        );
        return;
      }
      const organization = findOrganization(organizations, positionals[0]!);
      await updateAuth({
        orgId: organization.id,
        orgName: organization.name,
        ...(organization.slug ? { orgSlug: organization.slug } : {}),
      });
      // Local selection is authoritative. The account preference endpoint is
      // intentionally left to the dashboard until it is documented.
      output.result(
        organization,
        `Using ${organization.name} (${organization.slug ?? organization.id}).`
      );
      return;
    }
    const cloud = await cloudFor(values);
    if (operation === "current") {
      output.result(
        cloud.organization,
        `${cloud.organization.name} (${cloud.organization.slug ?? cloud.organization.id})`
      );
      return;
    }
    const updated =
      values.name !== undefined || values.slug !== undefined
        ? await cloud.call(
            cloud.client.POST("/api/auth/organization/update", {
              body: {
                organizationId: cloud.organization.id,
                data: {
                  ...(values.name !== undefined ? { name: values.name } : {}),
                  ...(values.slug !== undefined ? { slug: values.slug } : {}),
                },
              },
            })
          )
        : cloud.organization;
    let logoUrl: string | undefined;
    if (logo && values.logo) {
      const form = new FormData();
      const mime =
        (
          {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".webp": "image/webp",
          } as Record<string, string>
        )[extname(values.logo).toLowerCase()] ?? "application/octet-stream";
      form.append(
        "file",
        new Blob([new Uint8Array(logo)], { type: mime }),
        basename(values.logo)
      );
      const result = await cloud.call(
        cloud.client.POST("/api/v1/organizations/{id}/logo", {
          params: { path: { id: cloud.organization.id } },
          body: { file: values.logo },
          bodySerializer: () => form,
        })
      );
      logoUrl = result.url;
    }
    if (saved.orgId === cloud.organization.id)
      await updateAuth({
        ...(values.name ? { orgName: values.name } : {}),
        ...(values.slug ? { orgSlug: values.slug } : {}),
      });
    output.result(
      { ...updated, ...(logoUrl ? { logo: logoUrl } : {}) },
      `✓ Updated organization “${plain(updated.name ?? cloud.organization.name)}”\n${fields(
        [
          ["ID", updated.id],
          ["Slug", updated.slug],
          ["Logo", logoUrl],
        ]
      )}`
    );
  });
}
