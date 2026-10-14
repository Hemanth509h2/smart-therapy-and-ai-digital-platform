import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy .env.example to .env and `export $(cat .env | xargs)`).");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
await client.end();
console.log("Feedback schema applied.");
