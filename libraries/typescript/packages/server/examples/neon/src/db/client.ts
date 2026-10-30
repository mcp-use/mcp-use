import { attachDatabasePool } from "@neon/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDatabaseUrl } from "../env.js";

const createDb = (databaseUrl: string) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  attachDatabasePool(pool);

  return drizzle(pool);
};

let db: ReturnType<typeof createDb> | undefined;

/** Reuse the branch's Drizzle client and its connection pool within this isolate. */
export const getDb = () => {
  db ??= createDb(getDatabaseUrl());

  return db;
};
