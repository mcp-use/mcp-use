import type { Cloud, DeployValues } from "./types.js";

/** Update deploy configuration without repointing a server's production branch. */
export async function syncServerConfiguration(
  cloud: Cloud,
  serverId: string,
  values: DeployValues
): Promise<void> {
  const config = {
    ...(values["root-dir"] !== undefined
      ? { rootDir: values["root-dir"] }
      : {}),
    ...(values["build-command"] !== undefined
      ? { buildCommand: values["build-command"] }
      : {}),
    ...(values["start-command"] !== undefined
      ? { startCommand: values["start-command"] }
      : {}),
    ...(values.dockerfile !== undefined
      ? { dockerfilePath: values.dockerfile }
      : {}),
  };
  const body = {
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.region !== undefined ? { region: region(values.region) } : {}),
    ...(values["watch-paths"] !== undefined
      ? { watchPaths: values["watch-paths"] }
      : {}),
    ...(values["wait-for-ci"] !== undefined
      ? { waitForCi: values["wait-for-ci"] }
      : {}),
    ...(Object.keys(config).length ? { config } : {}),
  };
  if (Object.keys(body).length)
    await cloud.call(
      cloud.client.PATCH("/api/v1/servers/{id}", {
        params: { path: { id: serverId } },
        body,
      })
    );
}

/** Cloud region values are validated at the command boundary. */
export function region(
  value: string
): "AUTO" | "US" | "EU" | "APAC" | "GLOBAL" {
  return value.toUpperCase() as "AUTO" | "US" | "EU" | "APAC" | "GLOBAL";
}
