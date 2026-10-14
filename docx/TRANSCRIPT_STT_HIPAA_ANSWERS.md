# Transcript, STT, AI & HIPAA — How It Works Today

**Date:** 2026-10-12 · **Based on:** the code on `main` (not the PRD). File paths are included so each answer can be checked.

**Short version:** Live speech-to-text works through Sarvam. The transcript is English text only (no audio). It's stored on the Firestore `sessions/{sessionId}` doc and wiped after 24 hours. Before that, an AI report is generated from it and kept permanently in Postgres. The in-call AI copilot works, but only when the therapist clicks the button. Security is partly done: Firestore rules are solid, but several API routes have no auth. **HIPAA compliance has not been verified.**

---

## 1. Speech-to-text (STT)

**Is speech converted to text automatically during the call?**
Yes, but only when **both therapist and client have consented** to AI (`AIConsentBanner`). After that it starts automatically when the call connects. Code: `frontend/src/hooks/useSessionTranscription.ts`, gate in `frontend/src/app/session/[sessionId]/page.tsx` (~line 758–770).
- It runs **only in the therapist's browser**. That browser takes its own mic (labelled `therapist`) and the patient's incoming audio (labelled `client`), so each line gets a speaker label without any guessing.
- Dev escape hatch: `NEXT_PUBLIC_STT_TEST_MODE=true` lets it run with only the therapist's consent. This must stay `false` in production.

**Deepgram or Sarvam?**
- **Sarvam is the live engine and it's fully wired.** It uses model `saaras:v3` in `translate` mode, so any Indian language goes in and **English text comes out**.
- Audio path: browser → WebSocket → our relay (`backend/server.js` `/api/sarvam-stream` locally, or the Fly.io relay when `NEXT_PUBLIC_STT_RELAY_URL` is set) → Sarvam. The relay exists because Sarvam needs the API key in a header, and browsers can't set headers on a WebSocket.
- **Deepgram is leftover code and not used in the live flow.** `backend/src/app/api/deepgram-token/route.ts` and `lib/rag/transcription.ts` still exist, but no session page calls them.

**Live or after the call?**
**Live.** Each finished phrase is written to Firestore immediately and also shown as a caption to both people (LiveKit `lk.transcription` topic → `CaptionOverlay`).

---

## 2. Transcript storage

**What is stored?**
**Text only.** There is **no audio recording**: no LiveKit egress, no MediaRecorder, nothing saved to storage. Audio is streamed to Sarvam and thrown away.

Each line looks like this:
```json
{ "text": "...", "speaker": "therapist" | "client", "timestamp": 1760000000000, "sessionMinute": 3 }
```
The text is the **English translation**. The original-language text is not saved.

**Where?**
Firestore, document `sessions/{sessionId}`, field `transcript[]` (appended with `arrayUnion`), plus `transcriptLastUpdated`.

The same doc also holds `aiConsent`, `aiInsight`, `copilotEvents`, `moduleEvents[]`, `therapistNotes[]` and `reportStats`.

**Linked to the right patient and session?**
- **Session:** yes. The Firestore doc ID is the Postgres `Session.id`.
- **Patient:** indirectly. The transcript doc doesn't store the patient ID. You get it through Postgres `Session.clientId`. Inside the transcript, people are only labelled `therapist` or `client`.

**Can we read it after the session? Is it deleted?**
- Yes, but **only for 24 hours.** The cron `GET /api/cleanup-transcripts` empties `transcript` on any session whose last update is older than `retention.transcriptHours` (default **24**, adjustable in admin settings). Code: `backend/src/app/api/cleanup-transcripts/route.ts`.
- What stays **permanently** is the **AI session report**: Postgres `SessionReport` (generated when the call ends) and `reportStats` on the Firestore doc. The raw transcript does not stay.

---

## 3. AI assistant

There are **two separate AI features**:

| | In-call copilot ("Analyse") | End-of-session report |
|---|---|---|
| Trigger | **Manual.** The therapist clicks Analyse (`handleAnalyse`, session page) | **Automatic.** Fired when the therapist ends the call |
| API | `POST /api/ai-insight` | `POST /api/session-report` |
| Uses transcript? | Yes, the last ~5 minutes (`transcriptWindowMinutes`) | Yes, the full transcript + activity log + therapist notes |
| Output | Summary, suggested module/next step, **risk flag** (a separate safety scan runs in parallel) | Markdown report: summary, emotional state, engagement, observations, risk, next steps |
| Saved to | Firestore `aiInsight` + `copilotEvents`; Postgres `RiskFlag` (watch/urgent) | Postgres `SessionReport` (therapist can edit) |
| Code | `backend/src/lib/rag/analysis.ts`, `retrieval.ts`, `safety.ts`, `prompt.ts` | `backend/src/lib/report/generate.ts`, `session-data.ts`, `stats.ts` |
| Model | OpenRouter, `OPENROUTER_COPILOT_MODEL` (default free Nemotron) + NVIDIA embeddings for RAG study material | OpenRouter, `OPENROUTER_MODEL` (default free Nemotron) |

**Summaries / insights / emotion analysis?**
Summaries and session insights: **yes**. "Emotional state" comes from the LLM reading the text. There is **no audio- or voice-based emotion detection**. Separately, **attention scoring** from the video (face tracking, `useAttentionScoring`) writes into `rawSessionLog` and feeds the report stats.

**Complete, or is something missing?**
The pipeline works end to end. Gaps:
- The copilot is **not automatic**; it needs a click.
- On the copilot call, the session page sends a **placeholder client profile** (`age: 0`, `conditions: []`, `sessionNumber: 1`), so the copilot doesn't see the real diagnosis or history. The report route does load the real client from Postgres.
- If the end-of-call report request fails (tab closed, network drop), nothing retries it, and the transcript is gone 24 hours later.
- Both default models are **free OpenRouter models**. Sending patient text to a free third-party model is a HIPAA/privacy problem (see §4).

---

## 4. HIPAA & security

Reference: `docx/SECURITY_AUDIT_2026-10-06_v2.md` (6 Oct). I re-checked the main items against current code on 12 Oct.

**Implemented ✅**
- **Login:** Firebase Auth. The backend verifies the Firebase ID token (`Authorization: Bearer …`) in `backend/src/lib/apiAuth.ts`. `requireAdmin` now protects `/api/admin/*`.
- **Firestore rules** (`backend/firestore.rules`): a session's transcript, notes and insight can be read **only by users in that session's `allowedUids`**, which only the server writes. Clients can't create or delete session docs. Tested in `backend/tests/firestore-rules.test.ts`.
- **AI consent:** both parties must agree before STT or AI runs (enforced on the server too in `ai-insight`).
- **Data minimisation:** no audio is stored, and transcripts are deleted after 24 hours.
- **Short-lived STT token** (HMAC, 1 hour, tied to the session ID) from `/api/stt-token`, which checks that the caller is the session's therapist.
- **Encryption:** HTTPS/WSS in transit. At rest it's the providers' default encryption (Firebase/Google Cloud, Neon Postgres). There is **no application-level encryption** of transcripts.
- **Partial audit trail:** `copilotEvents`, `UsageEvent`, `RiskFlag`, `CronRun`. These record AI activity, **not who viewed what**.

**Not done / open risks ❌**
- **API routes with no auth:** `GET /api/clients` (no params returns **every** client), `/api/sessions` and `/api/sessions/[id]` (GET and PATCH), `/api/bookings`, `/api/session-report` (read and **overwrite** reports), `/api/ai-insight`, `/api/livekit-token` (anyone can get a token to join a room). This is the biggest PHI exposure.
- **The STT WebSocket relay in `server.js` doesn't verify the STT token** (there's a TODO in the code). `deepgram-token` only checks that a header exists.
- Firestore `sessions` updates aren't restricted by field. Any session member can rewrite `transcript` or flip the other person's `aiConsent` (audit H-02).
- **No access audit log** (who read which patient record and when). HIPAA requires one.
- **No BAAs.** Patient text goes to Sarvam, OpenRouter (free models), NVIDIA and LiveKit. HIPAA requires a Business Associate Agreement with every vendor that handles PHI. The free OpenRouter models almost certainly can't sign one.
- Secrets were previously committed to git history and need rotating (audit C-07). `AUTH_DISABLED` has no production guard (C-08).
- No rate limiting and no security headers.

**Have we verified HIPAA compliance?**
**No.** We have some security controls, but no compliance assessment: no risk analysis, BAAs, access audit log, breach procedure or policies. Today the accurate statement is **"some HIPAA-aligned security features"**, not "HIPAA compliant". (We serve patients in India, so the DPDP Act 2023 is probably the more relevant law to check.)

---

## 5. Your task — what's incomplete and where

Nobody has formally assigned this yet, so please agree on scope with the team. These are the real gaps, most important first:

| # | Gap | Where to work |
|---|---|---|
| 1 | Add `requireAuth` + ownership checks to the open patient-data routes | `backend/src/app/api/{clients,sessions,sessions/[sessionId],bookings,session-report,ai-insight,livekit-token}/route.ts`, helper in `lib/apiAuth.ts` |
| 2 | Verify the HMAC STT token on the WebSocket relay | `backend/server.js` (upgrade handler, TODO at the `sarvam-stream` branch); token format in `lib/stt-token.ts` |
| 3 | Field-level Firestore rules: consent only by your own role key, transcript append-only | `backend/firestore.rules` + `backend/tests/firestore-rules.test.ts` |
| 4 | Send the real client profile to the copilot (diagnosis, age, session number). Better: load it on the server from Postgres | `frontend/src/app/session/[sessionId]/page.tsx` `handleAnalyse`; `backend/src/app/api/ai-insight/route.ts` |
| 5 | Make report generation reliable: retry, or generate before the 24h cleanup if it's missing | `api/session-report`, `api/cleanup-transcripts` |
| 6 | Optional: auto-run the copilot every N minutes | session page |
| 7 | Remove dead Deepgram code (`api/deepgram-token`, `lib/rag/transcription.ts`) | backend + frontend `lib/rag` |
| 8 | Access audit log (who read which transcript/report) | new Prisma model + calls in the routes above |

### Testing the flow end to end (speech → transcript → storage → AI)

There is **no automated end-to-end test** for this flow yet; only the Firestore-rules and attention-scoring unit tests exist. Manual check:

1. Run the backend (`cd backend && npm run dev`, port 4000) and the frontend (`cd frontend && npm run dev`). Make sure `SARVAM_API_KEY` and `OPENROUTER_API_KEY` are set in `backend/.env`.
2. Log in as a therapist, start a session, and open the patient link in a second browser or incognito window.
3. **Both** accept the AI consent banner. The top bar should show a pulsing "N lines" counter.
4. Speak (Hindi or English). English captions appear for both people. **Speech → transcript ✓**
5. Firebase console → Firestore → `sessions/<sessionId>` → `transcript[]` has `{text, speaker, timestamp, sessionMinute}` entries. **Storage ✓**
6. Click **Analyse** in the AI panel → a suggestion appears, and `aiInsight` + `copilotEvents` show up on the same doc. **AI copilot ✓**
7. End the call → after a few seconds `GET /api/session-report?sessionId=<id>` returns the report (also shown in the session report drawer). **AI report ✓**
8. Optional: call `GET /api/cleanup-transcripts` with the `x-cron-secret` header (after lowering `retention.transcriptHours` to 1 and waiting) → `transcript` becomes `[]` while the report stays. **Retention ✓**

Writing steps 4–7 as an automated test (mock Sarvam and OpenRouter, use the Firestore emulator) would be a useful first task.
