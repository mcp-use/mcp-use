/**
 * Which server and organization a cloud command acts on. Every command that
 * takes `--server` or `--org` resolves them here, so the order is the same
 * everywhere:
 *
 * - **Server:** `--server`, then `MANUFACT_SERVER`, then the project link.
 * - **Organization:** `--org`, then `MANUFACT_ORG`, then the project link's
 *   organization, then the active organization (`mcp-use org use`), then the
 *   account default.
 *
 * Servers and organizations may be given by id or slug.
 */
import { connectCloud } from "../api/client.js";
import { UsageError } from "../../core/errors.js";
import { projectRoot, readProjectLink, type ProjectLink } from "./link-file.js";

/** The flags a project-scoped command accepts. */
export interface ProjectFlags {
  /** `--server`: server id or slug. */
  server?: string | undefined;
  /** `--org`: organization id or slug. */
  org?: string | undefined;
  /** `--path`: project root. Defaults to the working directory. */
  path?: string | undefined;
}

/** `parseCommandArgs` options for {@link ProjectFlags}. */
export const PROJECT_OPTIONS = {
  server: { type: "string" },
  org: { type: "string" },
  path: { type: "string" },
} as const;

/** The server from `--server`, `MANUFACT_SERVER` or the link, if any. */
function serverSelector(
  flags: ProjectFlags,
  link: ProjectLink | null
): string | undefined {
  return (
    flags.server ?? nonEmpty(process.env["MANUFACT_SERVER"]) ?? link?.serverId
  );
}

/**
 * The organization from `--org`, `MANUFACT_ORG` or the link. `undefined`
 * leaves the choice to `connectCloud`, which takes the active organization
 * (`mcp-use org use`), then the account default.
 */
function organizationSelector(
  flags: ProjectFlags,
  link: ProjectLink | null
): string | undefined {
  return flags.org ?? nonEmpty(process.env["MANUFACT_ORG"]) ?? link?.orgId;
}

/** What a project-scoped command acts on. */
export interface ResolvedProject {
  /** A Cloud connection scoped to the resolved organization. */
  cloud: Awaited<ReturnType<typeof connectCloud>>;
  /** The server id or slug, as given or as linked. */
  server: string;
  /** The project root. */
  root: string;
}

/**
 * Resolve the server and organization for a project-scoped command and
 * connect to Cloud as that organization.
 *
 * When no server is given and the project is not linked, `pickServer` (a
 * terminal prompt) chooses one. Without it the command fails with
 * `project_not_linked` (exit 2) before any request is sent.
 */
export async function connectProject(
  flags: ProjectFlags,
  options: {
    pickServer?:
      | ((cloud: ResolvedProject["cloud"]) => Promise<string>)
      | undefined;
  } = {}
): Promise<ResolvedProject> {
  const root = projectRoot(flags.path);
  const link = await readProjectLink(root);
  const server = serverSelector(flags, link);
  if (server === undefined && options.pickServer === undefined) {
    throw new UsageError(
      "No server given and this project is not linked. Pass --server <id-or-slug> or set MANUFACT_SERVER.",
      {
        code: "project_not_linked",
        nextSteps: [
          {
            description: "Link this project to a server",
            command: "mcp-use link --server <id-or-slug>",
          },
        ],
      }
    );
  }
  const cloud = await connectCloud({
    organization: organizationSelector(flags, link),
  });
  return {
    cloud,
    server: server ?? (await options.pickServer!(cloud)),
    root,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
