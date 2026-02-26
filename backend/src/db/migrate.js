import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withClient } from "./pool.js";

async function runMigration(fileName) {
  const sqlPath = join(process.cwd(), "migrations", fileName);
  const sql = await readFile(sqlPath, "utf-8");
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function main() {
  const migrationDir = join(process.cwd(), "migrations");
  const files = (await readdir(migrationDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await runMigration(file);
  }
  console.log("Migrations applied.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Migration failed", error);
  process.exit(1);
});
