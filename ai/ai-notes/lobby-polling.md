# Lobby polling during a call

Notes for whoever (human or AI) works on the waiting room next. Written 2026-10-20.

## Symptom

Backend log during a live call shows a steady stream of lobby requests for the
whole call, repeating roughly as GET, GET, POST:

```
GET  /api/sessions/{id}/lobby → 200 (~500–1700ms)
GET  /api/sessions/{id}/lobby → 200
POST /api/sessions/{id}/lobby → 200 (~1700–2400ms)
```

All 200s, so not an error. This is by design: two polling loops, one per side.

## Cause

### 1. Therapist side: `GET /lobby` every 3s

- `frontend/src/components/session/LobbyRequests.tsx` — `setInterval(load, POLL_MS)`, `POLL_MS = 3000`.
- Drives the "Clients / N waiting" button and auto-opens the panel when someone new knocks.
- It polls because the lobby lives at `liveSessions/{sessionId}/lobby/{uid}`, a
  server-only Firestore path (no security rule matches it), so the browser
  can't subscribe to it.
- Rendered from `frontend/src/app/session/[sessionId]/page.tsx` in two places
  (line ~1060 floating, for the skill-module layout; line ~1086 in
  `SessionTopBar`). They are in opposite branches of a ternary, so only one
  instance runs at a time. Not a double-mount.

### 2. Guest side: `POST /lobby` every 3s waiting, 5s once admitted

- `frontend/src/components/session/GuestAdmissionGate.tsx` — `setTimeout(knock, admitted ? ADMITTED_POLL_MS : POLL_MS)`.
- Keeps polling after admission for two reasons:
  - to learn it was removed, so the room unmounts;
  - each POST calls `touchLobbyEntry`, which keeps the guest listed under
    "In the call" for the therapist.
- Uses `setTimeout` after each response, so the real period is 5s + latency
  (~6.7s). That is why the log shows about 2 GETs per POST.
- `focus` / `visibilitychange` also trigger an immediate extra knock.

### Backend cost per request

`backend/src/app/api/sessions/[sessionId]/lobby/route.ts`

- `POST`: Prisma `session.findUnique` + Firestore `getLobbyEntry` + Firestore `touchLobbyEntry` write.
- `GET`: `requireSessionTherapist` (Prisma) + `listLobby` (Firestore).

Latency is the bigger concern: lobby POST ~1.7s, lobby GET 0.5–1.7s, and the
unrelated `PATCH /api/sessions/{id}` takes 3–4s.

## Done (2026-10-20)

- Guest: heartbeat after admission 5s → 15s. Focus + visibilitychange no
  longer double-knock (2s minimum gap).
- Therapist:
  - poll is a chained timeout (no overlap with slow responses);
  - 3s while someone waits or the panel is open, 8s otherwise;
  - nothing while the tab is hidden;
  - opening the panel fetches immediately.
- Server: `touchLobbyEntry` skips the Firestore write if `lastSeen` is under
  10s old (`TOUCH_EVERY_MS` in `lib/sessions/lobby.ts`).

## Still open

1. **Stop lobby polling once the guest is in the call.**
   - Both sides are already in the LiveKit room.
   - `PATCH action:'remove'` already calls `removeParticipantByUid`, which
     disconnects the guest. The guest can react to the LiveKit disconnect
     instead of polling.
   - The therapist can build "In the call" from LiveKit participants instead
     of `touchLobbyEntry` heartbeats.
   - Lobby polling then only runs while someone is actually waiting.
2. Separately, look into why `PATCH /api/sessions/{id}` takes 3–4s.
