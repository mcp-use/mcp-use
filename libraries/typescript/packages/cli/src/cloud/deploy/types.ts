import type { connectCloud } from "../api/client.js";
import type { ProjectLink } from "../project/link-file.js";

/** Cloud connection shared by deployment sources. */
export type Cloud = Awaited<ReturnType<typeof connectCloud>>;

/** Options accepted by deploy. */
export interface DeployValues {
  org?: string;
  server?: string;
  name?: string;
  branch?: string;
  "root-dir"?: string;
  region?: string;
  env?: string[];
  "env-file"?: string;
  "build-command"?: string;
  "start-command"?: string;
  dockerfile?: string;
  "watch-paths"?: string[];
  "wait-for-ci"?: boolean;
  "no-github"?: boolean;
  "external-url"?: string;
  "no-wait"?: boolean;
  new?: boolean;
  open?: boolean;
  yes?: boolean;
  json?: boolean;
}

/** The common inputs to each deploy source. */
export interface DeployInput {
  cloud: Cloud;
  cwd: string;
  existing: ProjectLink | null;
  values: DeployValues;
  env: Record<string, string>;
  /** Begin progress after interactive Git preparation has finished. */
  onDeploying: () => void;
  linkedServer?: {
    isExternal: boolean;
    connectedRepository?: { isManaged: boolean; productionBranch: string };
  };
}

/** Source-independent deployment identity. */
export interface StartedDeployment {
  sourceType: "github" | "managed";
  serverId: string;
  deploymentId: string;
}
