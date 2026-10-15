import { Pool } from "pg";
import { config } from "../config.js";

let pool = null;

export function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is not set.");
    }
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}