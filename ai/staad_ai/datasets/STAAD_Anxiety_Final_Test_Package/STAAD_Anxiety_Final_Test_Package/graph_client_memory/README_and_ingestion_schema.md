# STAAD Anxiety Client / Graph Memory Package

## Purpose
This is the **client-specific memory half** of the STAAD Anxiety knowledge architecture.

The Anxiety RAG package stores general knowledge. This package defines how STAAD can represent what is documented about a particular client across sessions.

## Anxiety-specific memory
In addition to the generic client-memory entities, anxiety memory explicitly supports:
- anxiety presentation
- symptoms/difficulties
- contexts
- documented triggers/antecedents
- avoidance behaviours
- functional impact
- goals
- interventions
- responses
- progress measures
- recurring patterns
- risk events
- provenance/source records

## Critical rule: trigger ≠ cause
A relationship such as `Observation -> associated_with_trigger -> Speaking in group` does **not** mean the system has proven that speaking in a group caused the anxiety. It means that the documented session associated the observation with that context/antecedent.

## Example
Client -> has_anxiety_presentation -> Social anxiety disorder
Client -> has_symptom -> Fear of negative evaluation
Client -> has_goal -> Increase appropriate participation
Session -> contains_observation -> Avoided speaking
Observation -> has_context -> Group activity
Observation -> associated_with_trigger -> Speaking in group
Session -> uses_intervention -> Clinician-guided CBT intervention
Session -> records_response -> Participation increased with structured support
Repeated evidence -> supports -> Pattern

## Files
- anxiety_graph_ontology.json
- anxiety_graph_nodes.jsonl
- anxiety_graph_edges.jsonl
- anxiety_session_memory_template.jsonl
- anxiety_graph_nodes.csv
- anxiety_graph_edges.csv
- data_dictionary.csv
- illustrative_anxiety_client_memory_schema.sql

## Production provenance
Every production memory item should ideally contain: client_id, session_id/event_id, timestamp, source reference, provenance type, author/system, status/confidence, created_at and updated_at.

Provenance types: observed, reported, inferred, summarized.

## Safety
The graph is a memory/context mechanism, not a diagnostic authority.
Do not:
- automatically diagnose anxiety from graph patterns
- infer causes without evidence
- prescribe or modify medication
- dismiss physical symptoms as anxiety
- generate high-risk exposure instructions
- expose one client's memory to another client

## Architecture
Session/transcript/events -> Secure session store -> Anxiety client-memory extraction -> Graph/client memory -> Context Manager -> AI Copilot

In parallel: Anxiety RAG -> general clinical knowledge -> Context Manager.

The Copilot receives both sources but must distinguish general evidence from client-specific facts.

## Synthetic data
All client examples in this package are synthetic and are not real patient records.


## Test-build clarifications
- The canonical concept nodes are terminology concepts, not client facts.
- All example client/session nodes and all edges are synthetic and not production eligible.
- The pattern node is explicitly marked as not established from one synthetic session.
- Do not load the synthetic graph examples into a production client database.
