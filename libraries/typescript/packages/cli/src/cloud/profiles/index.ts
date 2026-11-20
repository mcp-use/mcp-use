import { setTimeout as delay } from "node:timers/promises";

import { cloudFor, projectServer } from "../options.js";
import { cloudHelp } from "../help.js";
import { PROJECT_OPTIONS } from "../project/resolve.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { openBrowser } from "../../core/open-browser.js";
import { date, plain } from "../../core/format.js";
import { withProgress } from "../../core/progress.js";
import { formatProfile, formatProfileList, profileSummary } from "./output.js";

const USAGE = "mcp-use profiles <list|get|create> [options]";
const LIST_PROFILES = {
  description: "List profiles",
  command: "mcp-use profiles list --json",
};
const CREATE_PROFILE = {
  description: "Start a new sign-in",
  command: "mcp-use profiles create",
};
/** Poll failures that say nothing about the session; keep waiting. */
const TRANSIENT = new Set([
  "cloud_unreachable",
  "cloud_timeout",
  "rate_limited",
]);
const MAX_POLL_RETRIES = 5;

/** List, inspect and sign in to organization profiles (saved MCP credentials). */
export async function runProfiles(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("profiles", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const command = argv[0];
    if (command === "list" || command === "get") {
      const { values, positionals } = parseCommandArgs(argv.slice(1), {
        options: {
          org: PROJECT_OPTIONS.org,
          path: PROJECT_OPTIONS.path,
          json: { type: "boolean" },
        },
        positionals: command === "get" ? 1 : 0,
        usage:
          command === "get"
            ? "mcp-use profiles get <profileId> [options]"
            : "mcp-use profiles list [options]",
      });
      const cloud = await cloudFor(values);
      const { items } = await cloud.call(
        cloud.client.GET("/api/v1/organizations/{id}/profiles", {
          params: { path: { id: cloud.organization.id } },
        })
      );
      const profiles = items.map(profileSummary);
      if (command === "list") {
        output.result({ items: profiles }, formatProfileList(profiles));
        return;
      }
      // Cloud has no single-profile read; select from the organization's list.
      const found = profiles.find((profile) => profile.id === positionals[0]);
      if (!found)
        throw new CommandError(
          "profile_not_found",
          `Profile ${positionals[0]} was not found in organization ${cloud.organization.slug ?? cloud.organization.id}.`,
          undefined,
          [LIST_PROFILES]
        );
      output.result(found, formatProfile(found));
      return;
    }
    if (command !== "create") throw new UsageError(`Usage: ${USAGE}`);

    const { values } = parseCommandArgs(argv.slice(1), {
      options: {
        ...PROJECT_OPTIONS,
        json: { type: "boolean" },
        name: { type: "string" },
        url: { type: "string" },
        "no-wait": { type: "boolean" },
        "no-open": { type: "boolean" },
      },
      positionals: 0,
      usage:
        "mcp-use profiles create [--name <label>] [--url <mcp-url>] [options]",
    });
    const url = values.url === undefined ? undefined : signInUrl(values.url);
    const label = values.name?.trim() || undefined;
    // An explicit URL needs only the organization; otherwise Cloud signs in at
    // the linked (or --server) server's production MCP URL.
    const { cloud, serverId } =
      url === undefined
        ? await projectServer(values).then(({ cloud, server }) => ({
            cloud,
            serverId: server,
          }))
        : { cloud: await cloudFor(values), serverId: undefined };
    const organizationId = cloud.organization.id;
    const session = await cloud.call(
      cloud.client.POST("/api/v1/organizations/{id}/profile-sessions", {
        params: { path: { id: organizationId } },
        body: {
          ...(label !== undefined ? { label } : {}),
          ...(url !== undefined ? { url } : { serverId: serverId! }),
        },
      })
    );
    if (values["no-wait"] === true) {
      output.result(
        {
          sessionId: session.sessionId,
          status: session.status,
          authenticationUrl: session.authenticationUrl,
          expiresAt: session.expiresAt,
        },
        [
          `Open this page to sign in: ${plain(session.authenticationUrl)}`,
          `The sign-in expires at ${date(session.expiresAt) ?? plain(session.expiresAt)}.`,
          "Once signed in, find the profile: mcp-use profiles list",
        ].join("\n")
      );
      return;
    }
    // Written before waiting, so a caller without a terminal can open it.
    process.stderr.write(
      `Open this page to sign in: ${plain(session.authenticationUrl)}\n`
    );
    if (
      values["no-open"] !== true &&
      !output.json &&
      process.stdout.isTTY === true
    )
      openBrowser(session.authenticationUrl);

    const result = await withProgress(
      "Waiting for sign-in in the browser",
      output.json,
      () =>
        waitForSession(
          (sessionId) =>
            cloud.call(
              cloud.client.GET(
                "/api/v1/organizations/{id}/profile-sessions/{sessionId}",
                { params: { path: { id: organizationId, sessionId } } }
              ),
              {
                notFound: {
                  code: "profile_sign_in_expired",
                  nextSteps: [CREATE_PROFILE],
                },
              }
            ),
          session.sessionId,
          session.expiresAt
        )
    );
    const id = plain(result.profileId);
    output.result(
      {
        profileId: result.profileId,
        sessionId: result.sessionId,
        label: result.label,
        url: result.url,
        completedAt: result.completedAt,
      },
      [
        `✓ Signed in. Profile ${id}${result.label ? ` (${plain(result.label)})` : ""}`,
        "",
        "Use it with:",
        `  mcp-use checklist run --profile ${id}`,
        `  mcp-use evals run --profile ${id}`,
      ].join("\n")
    );
  });
}

/** Accept only an https MCP URL without credentials, as Cloud requires. */
function signInUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new UsageError("Pass --url as an https MCP server URL.");
  }
  if (parsed.protocol !== "https:")
    throw new UsageError("Pass --url as an https MCP server URL.");
  if (parsed.username || parsed.password)
    throw new UsageError("--url must not contain a username or password.");
  return parsed.toString();
}

interface ProfileSession {
  sessionId: string;
  status: "pending" | "authenticated" | "failed" | "expired";
  url: string;
  label: string | null;
  profileId: string | null;
  error: { code: string; message: string } | null;
  completedAt: string | null;
  expiresAt: string;
}

/** Poll until the browser finishes, fails or the session expires. */
async function waitForSession(
  read: (sessionId: string) => Promise<ProfileSession>,
  sessionId: string,
  expiresAt: string
): Promise<ProfileSession & { profileId: string }> {
  const configured = process.env["MCP_USE_POLL_INTERVAL_MS"];
  const interval =
    configured !== undefined && /^\d+$/.test(configured)
      ? Number(configured)
      : 2000;
  let deadline = Date.parse(expiresAt);
  let failures = 0;
  for (;;) {
    await delay(interval);
    let session: ProfileSession;
    try {
      session = await read(sessionId);
      failures = 0;
    } catch (error) {
      if (
        error instanceof CommandError &&
        TRANSIENT.has(error.code) &&
        ++failures <= MAX_POLL_RETRIES
      )
        continue;
      throw error;
    }
    if (session.status === "authenticated") {
      if (session.profileId === null)
        throw new CommandError(
          "cloud_api_error",
          `Profile sign-in ${sessionId} finished without a profile.`,
          undefined,
          [LIST_PROFILES]
        );
      return { ...session, profileId: session.profileId };
    }
    if (session.status === "failed") throw sessionFailed(session);
    if (session.status === "expired") throw sessionExpired();
    deadline = Date.parse(session.expiresAt) || deadline;
    if (Date.now() > deadline) throw sessionExpired();
  }
}

function sessionFailed(session: ProfileSession): CommandError {
  const reason = session.error?.code;
  // Cloud text must not control the terminal.
  const message = plain(session.error?.message) || "Profile sign-in failed.";
  if (reason === "cancelled")
    return new CommandError(
      "profile_sign_in_cancelled",
      "Profile sign-in was cancelled in the browser.",
      undefined,
      [CREATE_PROFILE]
    );
  if (reason === "oauth_not_required")
    return new CommandError("profile_oauth_not_required", message);
  return new CommandError("profile_sign_in_failed", message, undefined, [
    CREATE_PROFILE,
  ]);
}

function sessionExpired(): CommandError {
  return new CommandError(
    "profile_sign_in_expired",
    "The profile sign-in expired before it was finished in the browser.",
    undefined,
    [CREATE_PROFILE]
  );
}
