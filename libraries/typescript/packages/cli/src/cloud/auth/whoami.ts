/**
 * `mcp-use whoami`: who the current credential belongs to, the active
 * organization, and which key the CLI is using and where it came from.
 */
import { CommandError } from "../../core/errors.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { callerFor, createCloudClient } from "../api/client.js";
import {
  chooseOrganization,
  listOrganizations,
  sessionEmail,
  type CloudOrganization,
} from "./account.js";
import { readAuth, requireCredential } from "./store.js";

const USAGE = "mcp-use whoami [--json]";

const HELP = `Usage: ${USAGE}

Show the signed-in user, the active organization, and the API key in use.

Options:
  --json      Emit one JSON document
  -h, --help  Show this help

Exit codes:
  0  Signed in, or help
  1  Not signed in, or Cloud rejected the key`;

/** Run `mcp-use whoami`. */
export async function runWhoami(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, HELP, async (output) => {
    parseCommandArgs(argv, {
      options: { json: { type: "boolean" } },
      positionals: 0,
      usage: USAGE,
    });
    const credential = await requireCredential();
    const auth = await readAuth();
    const api = {
      client: createCloudClient({ apiKey: credential.apiKey }),
      call: callerFor(credential.apiKey),
    };
    const [email, organizations] = await Promise.all([
      sessionEmail(api),
      listOrganizations(api),
    ]);
    const organization = await activeOrganization(
      api,
      organizations,
      auth.orgId
    );
    const fromFile = credential.source.type === "file";
    const result = {
      email,
      organization,
      keyName: fromFile ? (auth.keyName ?? null) : null,
      credential: credential.source,
    };
    output.result(
      result,
      [
        `Email:        ${email}`,
        `Organization: ${
          organization === null
            ? "none (run `mcp-use org use <id-or-slug>`)"
            : `${organization.name} (${organization.slug ?? organization.id})`
        }`,
        `API key:      ${result.keyName ?? "unnamed"}`,
        `Stored in:    ${
          credential.source.type === "file"
            ? credential.source.path
            : `$${credential.source.variable}`
        }`,
      ].join("\n")
    );
  });
}

/** The active organization, or `null` when there is none to act on. */
async function activeOrganization(
  api: Parameters<typeof chooseOrganization>[0],
  organizations: readonly CloudOrganization[],
  storedId: string | undefined
): Promise<CloudOrganization | null> {
  try {
    return (await chooseOrganization(api, organizations, { storedId })) ?? null;
  } catch (error) {
    // A saved organization the user has since left: report "none" here;
    // commands that need one say how to choose another.
    if (
      error instanceof CommandError &&
      error.code === "organization_required"
    ) {
      return null;
    }
    throw error;
  }
}
