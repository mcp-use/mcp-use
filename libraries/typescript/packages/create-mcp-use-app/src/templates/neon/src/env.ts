import { parseEnv } from "@neon/env";
import neonConfig from "../neon.js";

let databaseUrl: string | undefined;

/** Resolve the pooled connection URL injected for the current Neon branch. */
export const getDatabaseUrl = () => {
  databaseUrl ??= parseEnv(neonConfig, ["DATABASE_URL"]).postgres.databaseUrl;

  return databaseUrl;
};
