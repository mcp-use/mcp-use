import { date, fields, plain, table } from "../../core/format.js";
import type { paths } from "../api/generated/types.gen.js";

type ProfileItem = paths["/api/v1/organizations/{id}/profiles"]["get"] extends {
  responses: {
    200: { content: { "application/json": { items: (infer I)[] } } };
  };
}
  ? I
  : never;

/** A profile as the CLI shows it. Static secret values are never included. */
export interface ProfileSummary {
  id: string;
  label: string | null;
  kind: ProfileItem["kind"];
  status: ProfileItem["status"];
  reason: string | null;
  canUse: boolean;
  sharing: ProfileItem["sharing"];
  owner: { id: string | null; name: string | null };
  account: {
    email: string | null;
    name: string | null;
    issuerHost: string;
  } | null;
  connectedAt: string;
  bindings: Array<{
    serverId: string;
    serverName: string | null;
    target: "production" | "preview" | "branch";
    branch: string | null;
  }>;
}

/** Copy only known metadata, so a static profile's bearer or headers never reach output. */
export function profileSummary(item: ProfileItem): ProfileSummary {
  return {
    id: item.id,
    label: item.label,
    kind: item.kind,
    status: item.status,
    reason: item.reason,
    canUse: item.canUse,
    sharing: item.sharing,
    owner: { id: item.owner.id, name: item.owner.name },
    account: item.account
      ? {
          email: item.account.email,
          name: item.account.name,
          issuerHost: item.account.issuerHost,
        }
      : null,
    connectedAt: item.connectedAt,
    bindings: item.bindings.map((binding) => ({
      serverId: binding.serverId,
      serverName: binding.serverName,
      target: binding.target,
      branch: binding.branch,
    })),
  };
}

function account(profile: ProfileSummary): string | undefined {
  if (!profile.account) return undefined;
  const who = profile.account.email || profile.account.name;
  return who
    ? `${who} (${profile.account.issuerHost})`
    : profile.account.issuerHost;
}

function binding(item: ProfileSummary["bindings"][number]): string {
  const where =
    item.target === "branch" ? `branch ${item.branch}` : item.target;
  return `${item.serverName ?? item.serverId} · ${where}`;
}

/** Profiles as a table, or how to create the first one. */
export function formatProfileList(profiles: ProfileSummary[]): string {
  if (!profiles.length)
    return "No profiles in this organization.\nSign in to create one: mcp-use profiles create";
  return `${table(
    ["ID", "LABEL", "KIND", "STATUS", "ACCOUNT", "USABLE", "BINDINGS"],
    profiles.map((profile) => [
      profile.id,
      profile.label,
      profile.kind,
      profile.status,
      account(profile),
      profile.canUse ? "yes" : "no",
      profile.bindings.length,
    ])
  )}\n\nUse one: mcp-use checklist run --profile <id>`;
}

/** One profile's details, bindings and how to use it. */
export function formatProfile(profile: ProfileSummary): string {
  const lines = [
    plain(profile.label || profile.id),
    "",
    fields([
      ["ID", profile.id],
      ["Kind", profile.kind],
      [
        "Status",
        profile.reason
          ? `${profile.status} (${profile.reason})`
          : profile.status,
      ],
      ["Account", account(profile)],
      ["Owner", profile.owner.name],
      ["Sharing", profile.sharing === "org" ? "Organization" : "Owner only"],
      ["Usable by you", profile.canUse ? "Yes" : "No"],
      ["Connected", date(profile.connectedAt)],
    ]),
  ];
  if (profile.bindings.length)
    lines.push(
      "",
      "Bindings",
      ...profile.bindings.map((item) => `  ${plain(binding(item))}`)
    );
  if (profile.canUse)
    lines.push(
      "",
      `Use it: mcp-use checklist run --profile ${plain(profile.id)}`,
      `        mcp-use evals run --profile ${plain(profile.id)}`
    );
  return lines.join("\n");
}
