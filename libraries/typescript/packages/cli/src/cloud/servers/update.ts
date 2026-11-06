import { plain, fields } from "../../core/format.js";
import { isIP } from "node:net";

import { parseCloudArgs, projectServer } from "../options.js";
import { cloudHelp } from "../help.js";
import { runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";

/** Update only explicitly supplied server settings. */
export async function updateServer(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("servers", ["update", ...argv]);
  return runCommand(argv, help, async (output) => {
    const { values, positionals } = parseCloudArgs(
      argv,
      {
        name: { type: "string" },
        description: { type: "string" },
        branch: { type: "string" },
        "root-dir": { type: "string" },
        "build-command": { type: "string" },
        "start-command": { type: "string" },
        "watch-paths": { type: "string", multiple: true },
        "deploy-branches": { type: "string", multiple: true },
        "wait-for-ci": { type: "boolean" },
        "no-wait-for-ci": { type: "boolean" },
        repo: { type: "string" },
        installation: { type: "string" },
        "disconnect-repo": { type: "boolean" },
        "allow-ip": { type: "string", multiple: true },
        "clear-allow-ip": { type: "boolean" },
      },
      "mcp-use servers update [server] [options]",
      0,
      1
    );
    if (values["wait-for-ci"] && values["no-wait-for-ci"])
      throw new UsageError("Use --wait-for-ci or --no-wait-for-ci, not both.");
    if (values.repo && values["disconnect-repo"])
      throw new UsageError("Use --repo or --disconnect-repo, not both.");
    if (values["allow-ip"] && values["clear-allow-ip"])
      throw new UsageError("Use --allow-ip or --clear-allow-ip, not both.");
    if (values.repo && !/^[^/\s]+\/[^/\s]+$/.test(values.repo))
      throw new UsageError("--repo must be owner/name.");
    const cidrs = values["allow-ip"]?.map(validateCidr);
    const config = {
      ...(values["root-dir"] !== undefined
        ? { rootDir: values["root-dir"] || null }
        : {}),
      ...(values["build-command"] !== undefined
        ? { buildCommand: values["build-command"] || null }
        : {}),
      ...(values["start-command"] !== undefined
        ? { startCommand: values["start-command"] || null }
        : {}),
    };
    const body = {
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.description !== undefined
        ? { description: values.description }
        : {}),
      ...(values.branch !== undefined
        ? { productionBranch: values.branch }
        : {}),
      ...(values["watch-paths"]
        ? { watchPaths: values["watch-paths"].filter(Boolean) }
        : {}),
      ...(values["deploy-branches"]
        ? { deployBranchPatterns: values["deploy-branches"].filter(Boolean) }
        : {}),
      ...(values["wait-for-ci"] ? { waitForCi: true } : {}),
      ...(values["no-wait-for-ci"] ? { waitForCi: false } : {}),
      ...(Object.keys(config).length ? { config } : {}),
    };
    if (
      !Object.keys(body).length &&
      !values.repo &&
      !values["disconnect-repo"] &&
      !cidrs &&
      !values["clear-allow-ip"]
    )
      throw new UsageError("Pass at least one server setting to update.");
    const { cloud, server, details } = await projectServer(
      values,
      positionals[0]
    );
    let repository = null;
    if (values.repo) {
      const [owner, repo] = values.repo.split("/") as [string, string];
      let installationId =
        values.installation ??
        details.connectedRepository?.githubInstallationId;
      if (!installationId) {
        const { installations } = await cloud.call(
          cloud.client.GET("/api/v1/github/installations", {
            params: { query: { organizationId: cloud.organization.id } },
          })
        );
        const matches: string[] = [];
        for (const installation of installations.filter(
          (item) =>
            item.isActive &&
            (item.organizationId === cloud.organization.id ||
              item.organizationId === null)
        )) {
          const access = await cloud.call(
            cloud.client.GET(
              "/api/v1/github/installations/{installationId}/repos/{owner}/{repo}/access",
              {
                params: {
                  path: {
                    installationId: installation.installationId,
                    owner,
                    repo,
                  },
                },
              }
            )
          );
          if (access.hasAccess) matches.push(installation.id);
        }
        if (matches.length !== 1)
          throw new UsageError(
            "Pass --installation <id> to choose the GitHub installation for this repository."
          );
        installationId = matches[0]!;
      }
      repository = await cloud.call(
        cloud.client.PUT("/api/v1/servers/{id}/repository", {
          params: { path: { id: server } },
          body: {
            installationId,
            repoFullName: values.repo,
            productionBranch:
              values.branch ??
              details.connectedRepository?.productionBranch ??
              "main",
            ...(values["root-dir"] !== undefined
              ? { rootDir: values["root-dir"] }
              : {}),
          },
        })
      );
    }
    if (values["disconnect-repo"])
      await cloud.call(
        cloud.client.DELETE("/api/v1/servers/{id}/repository", {
          params: { path: { id: server } },
        })
      );
    const result = Object.keys(body).length
      ? await cloud.call(
          cloud.client.PATCH("/api/v1/servers/{id}", {
            params: { path: { id: server } },
            body,
          })
        )
      : details;
    if (cidrs || values["clear-allow-ip"])
      await cloud.call(
        cloud.client.PATCH("/api/v1/servers/{id}/gateway/ip-access", {
          params: { path: { id: server } },
          body: {
            customCidrs: cidrs ?? [],
            ...(cidrs ? { enabled: true } : {}),
          },
        })
      );
    output.result(
      {
        server: result,
        ...(repository ? { repository } : {}),
        ...(values["disconnect-repo"] ? { repositoryDisconnected: true } : {}),
        ...(cidrs || values["clear-allow-ip"]
          ? { allowedIps: cidrs ?? [] }
          : {}),
      },
      `✓ Updated server “${plain(result.name ?? details.name ?? server)}”\n${fields(
        [
          ["ID", server],
          ["Repository", values.repo],
          [
            "Repository disconnected",
            values["disconnect-repo"] ? "Yes" : undefined,
          ],
          [
            "Allowed IPs",
            cidrs?.join(", ") ??
              (values["clear-allow-ip"] ? "Cleared" : undefined),
          ],
        ]
      )}`
    );
  });
}

function validateCidr(value: string): string {
  const [address, mask, extra] = value.split("/");
  const version = isIP(address ?? "");
  if (
    !version ||
    extra !== undefined ||
    (mask !== undefined &&
      (!/^\d+$/.test(mask) || Number(mask) > (version === 4 ? 32 : 128)))
  )
    throw new UsageError(
      "--allow-ip must be an IPv4/IPv6 address or CIDR range."
    );
  return value;
}
