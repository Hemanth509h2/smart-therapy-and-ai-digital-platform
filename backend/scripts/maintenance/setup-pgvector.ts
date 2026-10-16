import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const DATABASE_URL = process.env.DATABASE_URL!
const sql = neon(DATABASE_URL)

async function setupPgVector() {
  console.log('Setting up pgvector on Neon...')

  // Step 1: Enable pgvector extension
  await sql`CREATE EXTENSION IF NOT EXISTS vector;`
  const extCheck = await sql`
    SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
  `
  if (extCheck.length > 0) {
    console.log('✓ pgvector extension enabled:', extCheck[0])
  } else {
    console.error('✗ Failed to enable pgvector extension')
    process.exit(1)
  }

  // Step 2: Create document_chunks table
  await sql`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id  TEXT NOT NULL,
      session_id    TEXT,
      file_name     TEXT NOT NULL,
      chunk_index   INTEGER NOT NULL,
      chunk_text    TEXT NOT NULL,
      embedding     vector(1024),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      metadata      JSONB DEFAULT '{}'::jsonb
    );
  `
  console.log('✓ document_chunks table created')

  // Step 3: Create indexes
  await sql`
    CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
      ON document_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  `
  console.log('✓ IVFFlat index created on embedding column')

  await sql`
    CREATE INDEX IF NOT EXISTS document_chunks_therapist_idx
      ON document_chunks (therapist_id);
  `
  console.log('✓ Index created on therapist_id')

  console.log('\n✅ pgvector setup complete')
}

setupPgVector().catch(e => {
  console.error('❌ Setup failed:', e)
  process.exit(1)
})
