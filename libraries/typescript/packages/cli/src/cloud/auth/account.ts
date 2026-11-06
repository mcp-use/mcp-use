/**
 * Who a credential belongs to and which organization a command acts on,
 * from documented Cloud operations: the session, the organization list and
 * the user's preferences.
 */
import type { Client } from "openapi-fetch";
import type { paths } from "../api/generated/types.gen.js";
import type { Call } from "../api/client.js";
import { CommandError, type NextStep } from "../../core/errors.js";
import { LOG_IN } from "./store.js";

/** An organization the user belongs to. */
export interface CloudOrganization {
  id: string;
  name: string;
  slug: string | null;
  /** The user's role in it, e.g. `owner` or `member`. */
  role: string;
}

/** An unauthenticated or authenticated typed fetch connection. */
interface Api {
  client: Client<paths>;
  call: Call;
}

const LIST_ORGANIZATIONS: NextStep = {
  description: "List your organizations",
  command: "mcp-use org list --json",
};

const USE_ORGANIZATION: NextStep = {
  description: "Choose the active organization",
  command: "mcp-use org use <id-or-slug>",
};

/** The signed-in user's email. Throws `not_authenticated` for a bad key. */
export async function sessionEmail(api: Api): Promise<string> {
  const session = await api.call(api.client.GET("/api/auth/get-session"), {
    // Cloud answers an invalid API key on this route with a 403.
    forbidden: { code: "not_authenticated", nextSteps: [LOG_IN] },
  });
  if (session === null) {
    throw new CommandError(
      "not_authenticated",
      "Manufact Cloud did not accept the API key.",
      undefined,
      [LOG_IN]
    );
  }
  return session.user.email;
}

/** The organizations the user belongs to. */
export async function listOrganizations(
  api: Api
): Promise<CloudOrganization[]> {
  const { organizations } = await api.call(
    api.client.GET("/api/v1/organizations")
  );
  return organizations.map(({ id, name, slug, role }) => ({
    id,
    name,
    slug,
    role,
  }));
}

/** The organization the user chose as their default in the dashboard. */
export async function defaultOrganizationId(api: Api): Promise<string | null> {
  const preferences = await api.call(
    api.client.GET("/api/v1/user-preferences")
  );
  return preferences.defaultOrganizationId;
}

/**
 * The organization a command acts on: `selector` (an id or slug) when given,
 * else the stored one, else the user's only organization, else their
 * dashboard default. `undefined` when none of those applies.
 *
 * A selector or stored id that names no organization of the user's is an
 * error rather than a silent switch to another organization.
 */
export async function chooseOrganization(
  api: Api,
  organizations: readonly CloudOrganization[],
  wanted: { selector?: string | undefined; storedId?: string | undefined }
): Promise<CloudOrganization | undefined> {
  if (wanted.selector !== undefined) {
    return findOrganization(organizations, wanted.selector);
  }
  if (wanted.storedId !== undefined) {
    const stored = organizations.find((item) => item.id === wanted.storedId);
    if (stored === undefined) {
      throw new CommandError(
        "organization_required",
        "The saved organization is no longer one of yours.",
        undefined,
        [LIST_ORGANIZATIONS, USE_ORGANIZATION]
      );
    }
    return stored;
  }
  if (organizations.length <= 1) return organizations[0];
  const defaultId = await defaultOrganizationId(api);
  return organizations.find((item) => item.id === defaultId);
}

/** The organization whose id or slug is `selector`. */
export function findOrganization(
  organizations: readonly CloudOrganization[],
  selector: string
): CloudOrganization {
  const matches = organizations.filter(
    (item) => item.id === selector || item.slug === selector
  );
  if (matches.length === 0) {
    throw new CommandError(
      "organization_not_found",
      `Organization not found: ${selector}`,
      undefined,
      [LIST_ORGANIZATIONS]
    );
  }
  if (matches.length > 1) {
    throw new CommandError(
      "organization_ambiguous",
      `Several organizations match ${selector}; pass the organization id.`,
      undefined,
      [LIST_ORGANIZATIONS]
    );
  }
  return matches[0]!;
}

/** The error for a command that needs an organization and has none. */
export function organizationRequired(): CommandError {
  return new CommandError(
    "organization_required",
    "No active organization.",
    undefined,
    [LIST_ORGANIZATIONS, USE_ORGANIZATION]
  );
}
