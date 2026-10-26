-- Illustrative schema for client memory.
-- Adapt to the project's database/graph engine.

CREATE TABLE clients (
    client_id TEXT PRIMARY KEY,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    session_timestamp TIMESTAMP,
    module TEXT,
    source_reference TEXT,
    FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE memory_nodes (
    node_id TEXT PRIMARY KEY,
    client_id TEXT,
    entity_type TEXT NOT NULL,
    label TEXT NOT NULL,
    value_json TEXT,
    source_session_id TEXT,
    provenance_type TEXT, -- observed / reported / inferred / summarized
    confidence REAL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE memory_edges (
    edge_id TEXT PRIMARY KEY,
    client_id TEXT,
    source_node_id TEXT NOT NULL,
    relationship TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    source_session_id TEXT,
    provenance_type TEXT,
    confidence REAL,
    created_at TIMESTAMP
);

CREATE INDEX idx_memory_nodes_client ON memory_nodes(client_id);
CREATE INDEX idx_memory_nodes_type ON memory_nodes(entity_type);
CREATE INDEX idx_memory_edges_client ON memory_edges(client_id);
CREATE INDEX idx_sessions_client_time ON sessions(client_id, session_timestamp);
