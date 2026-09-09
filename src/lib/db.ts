import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const url = process.env.DATABASE_URL!;

// Next dev server hot-reloads modules; cache the client so we don't leak pools.
const g = globalThis as unknown as { _sql?: ReturnType<typeof postgres> };
export const sql = g._sql ?? postgres(url, { max: 5 });
if (process.env.NODE_ENV !== "production") g._sql = sql;

export const db = drizzle(sql, { schema });
