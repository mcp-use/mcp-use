/**
 * Signing the CLI in for tests of commands that need Cloud credentials.
 *
 * ```ts
 * test("…", async ({ cloud, cli }) => {
 *   signIn(cloud);
 *   const result = await cli.run(["deployments", "get", "dep_1", "--json"], {
 *     env: SIGNED_IN,
 *   });
 * });
 * ```
 */
import { organization } from "./cloud-fixtures.js";
import type { FakeCloud } from "./fake-cloud.js";

/** Environment that gives the CLI an API key without logging in. */
export const SIGNED_IN = { MANUFACT_TOKEN: "test_key" };

/**
 * Answer the organization lookup every authenticated command makes, with one
 * organization (`org_1`, slug `org-one`). With one organization the CLI acts
 * on it without asking Cloud for the user's default.
 */
export function signIn(cloud: FakeCloud): void {
  cloud.on("GET", "/api/v1/organizations", {
    body: {
      organizations: [
        organization({ id: "org_1", slug: "org-one", name: "Org One" }),
      ],
    },
  });
}
