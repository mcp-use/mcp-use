/**
 * `mcp-use logout`: revoke the CLI's API key on Cloud and delete the stored
 * credential.
 *
 * Logging out always deletes the local file, even when Cloud can't be
 * reached: a failed revoke is reported as a warning, not an error, so a user
 * is never left signed in on a machine they meant to sign out of.
 */
import { callerFor, createCloudClient } from "../api/client.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { confirm } from "../../core/prompt.js";
import { clearAuth, readAuth } from "./store.js";

const USAGE = "mcp-use logout [--yes] [--json]";

const HELP = `Usage: ${USAGE}

Revoke the API key \`mcp-use login\` created and delete ~/.manufact/auth.json.

Options:
  --yes       Confirm without prompting
  --json      Emit one JSON document; never prompt
  -h, --help  Show this help

Exit codes:
  0  Logged out (also when revoking the key failed; see warnings), cancelled,
     or help
  1  The local credential could not be deleted
  2  Confirmation is required: pass --yes`;

/** Something logout could not do; it still logged out. */
interface Warning {
  /** Stable code: `key_revoke_failed`, `key_not_revoked` or `env_credential_set`. */
  code: string;
  message: string;
}

/** Run `mcp-use logout`. */
export async function runLogout(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, async (output) => {
    const { values } = parseCommandArgs(argv, {
      options: { yes: { type: "boolean" }, json: { type: "boolean" } },
      positionals: 0,
      usage: USAGE,
    });
    if (
      !(await confirm("Log out?", {
        yes: values.yes === true,
        json: output.json,
      }))
    ) {
      return;
    }

    const auth = await readAuth();
    const warnings: Warning[] = [];
    let revoked = false;
    if (auth.apiKey !== undefined && auth.keyId !== undefined) {
      try {
        const result = await callerFor(auth.apiKey)(
          createCloudClient({ apiKey: auth.apiKey }).POST(
            "/api/auth/api-key/delete",
            {
              body: { keyId: auth.keyId },
            }
          )
        );
        revoked = result.success;
      } catch (error) {
        warnings.push({
          code: "key_revoke_failed",
          message: `Could not revoke the API key on Manufact Cloud: ${
            error instanceof Error ? error.message : String(error)
          } Revoke it in the dashboard if it is still listed.`,
        });
      }
      if (!revoked && warnings.length === 0) {
        warnings.push({
          code: "key_revoke_failed",
          message:
            "Manufact Cloud did not revoke the API key. Revoke it in the dashboard if it is still listed.",
        });
      }
    } else if (auth.apiKey !== undefined) {
      warnings.push({
        code: "key_not_revoked",
        message:
          "The stored API key was not created by `mcp-use login`, so it is still active. Revoke it in the dashboard if you no longer need it.",
      });
    }

    await clearAuth();

    for (const variable of ["MANUFACT_TOKEN", "MCP_USE_API_KEY"]) {
      const value = process.env[variable];
      if (value !== undefined && value !== "") {
        warnings.push({
          code: "env_credential_set",
          message: `${variable} is set, so cloud commands still use that key.`,
        });
      }
    }

    if (!output.json) {
      for (const warning of warnings) {
        process.stderr.write(`Warning: ${warning.message}\n`);
      }
    }
    output.result({ loggedOut: true, revoked, warnings }, "Logged out.");
  });
}
