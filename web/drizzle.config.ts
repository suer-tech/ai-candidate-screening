import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

const credentialPath = path.resolve(".runtime", "credentials", "database-url");
const url = process.env.DATABASE_URL?.trim() || readFileSync(credentialPath, "utf8").trim();

export default defineConfig({
  out: "./drizzle-postgres",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
});
