-- Illustrative schema only; adapt to STAAD's actual database, access model, and legal requirements.
CREATE TABLE client_memory_item (
  memory_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  session_id TEXT NULL,
  item_type TEXT NOT NULL,
  content_redacted TEXT NOT NULL,
  source_ref TEXT NULL,
  observed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL,
  review_status TEXT NOT NULL,
  approved_by TEXT NULL,
  expires_at TIMESTAMP NULL
);
CREATE INDEX idx_client_memory_scope ON client_memory_item(tenant_id, client_id, observed_at);
CREATE TABLE knowledge_record (
  record_id TEXT PRIMARY KEY,
  condition TEXT NOT NULL,
  topic TEXT NOT NULL,
  claim TEXT NOT NULL,
  source_ids TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  review_status TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
-- Enforce tenant/client authorization in application and database policy.
-- Do not treat these illustrative statements as a production security design.
