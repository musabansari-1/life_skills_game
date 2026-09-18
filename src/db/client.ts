/**
 * Database client. One libsql connection per process, migrations applied on
 * first use. Tests call `createTestDb()` for an isolated in-memory database.
 */
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle");

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = init();
  return dbPromise;
}

async function init(): Promise<Db> {
  if (env.DATABASE_URL.startsWith("file:")) {
    const file = env.DATABASE_URL.slice("file:".length);
    const dir = path.dirname(path.resolve(/*turbopackIgnore: true*/ process.cwd(), file));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const client = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** Isolated in-memory database with migrations applied. */
export async function createTestDb(): Promise<{ db: Db; client: Client }> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client };
}

export { schema };
