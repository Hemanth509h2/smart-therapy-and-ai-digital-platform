-- Illustrative relational backing schema; adapt to STAAD's approved database and access model.
CREATE TABLE client_memory_event (
  event_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,                 -- pseudonymous ID, not direct identity
  session_id TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  source_record_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN
    ('client_reported','clinician_observed','transcript_derived','clinician_entered','system_summarized')),
  event_type TEXT NOT NULL,
  content TEXT NOT NULL,
  attribution TEXT NOT NULL,
  confidence_or_review_status TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  retention_policy_ref TEXT,
  access_classification TEXT NOT NULL DEFAULT 'sensitive',
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_memory_client_time ON client_memory_event(client_id, timestamp DESC);
CREATE INDEX idx_memory_session ON client_memory_event(session_id);
CREATE INDEX idx_memory_source ON client_memory_event(source_record_id);

CREATE TABLE client_memory_edge (
  edge_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  confidence_or_review_status TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_edge_client ON client_memory_edge(client_id);
CREATE INDEX idx_edge_from ON client_memory_edge(from_node_id);
CREATE INDEX idx_edge_to ON client_memory_edge(to_node_id);

-- Apply row-level access controls, audit logging, retention/deletion, and encryption separately.
-- Never treat a graph edge as proof of causality or a symptom as a diagnosis.
