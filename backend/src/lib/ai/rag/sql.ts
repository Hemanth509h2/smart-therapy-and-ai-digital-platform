import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

// Connected on the first query so a missing DATABASE_URL never breaks
// builds/imports — it only fails when the RAG tables are actually queried.
let db: NeonQueryFunction<false, false> | null = null

export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  db ??= neon(process.env.DATABASE_URL!)
  return db(strings, ...values)
}
