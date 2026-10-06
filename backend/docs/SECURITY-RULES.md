# Firestore Security Rules — audit, redesign, and deployment plan

**Status: NOT DEPLOYED. NOT YET EMULATOR-TESTED.** See [Verification status](#verification-status).

---

## 1. What was wrong

The live ruleset (`staad-edtech`, ruleset `532266e1-553b-40a4-84a7-53cb8b09b848`) ended with:

```
match /{document=**} {
  allow read, write: if request.auth != null;
}
```

`{document=**}` matches at any depth. Firestore ORs its match rules, so this single clause granted **every authenticated account full read and write access to every document in the database** — every patient's transcript, attention score, consent state, therapist notes and quest list. The four named `match` blocks above it (`users`, `liveSessions`, `moduleStates`, `presence`) granted exactly what the catch-all already granted, so they were decorative. The rules' own comment said *"For production, tighten these rules!"*

Any logged-in account — including a newly registered client — could read another patient's session by guessing or enumerating a session id.

## 2. What is actually stored in Firestore

An audit of every `collection()` / `doc()` call in `src/` found **four** collections, not the five the old rules implied:

| Collection | Contents | Written by |
|---|---|---|
| `liveSessions/{sessionId}` | Live room state: participants, activeModuleId, whiteboard flags, reactions, per-module state | Both participants, constantly |
| `sessions/{sessionId}` | Durable record: `aiConsent`, `transcript[]`, `aiInsight`, `moduleEvents[]`, `therapistNotes[]` | Both participants + Admin SDK |
| `sessions/{sessionId}/rawSessionLog/{id}` | Session diary: attention scores (new) | Therapist browser |
| `moduleStates/{sessionId}_{moduleId}` | Shared module state | Both participants |
| `patients/{patientUid}` | Cross-session quest list (MicroQuestBoard) | Therapist + patient |

**`users` and `presence` do not exist.** User profiles, notes, bookings, plans, subscriptions and invites all live in **Postgres via Prisma**. Those two rules were dead.

## 3. The core problem: Firestore cannot see entitlement

Who is allowed into a session lives in Postgres — `Session.therapistId → ProfileTherapist.userId` and `Session.clientId → ProfileClient.userId`. Rules cannot query Postgres.

The old client-side join flow made this worse: the browser **created** `liveSessions/{id}` itself, inventing the participant list. Any rule keyed off that list would have been circular — the client authorising itself.

**The fix:** entitlement is mirrored into Firestore as `liveSessions/{id}.allowedUids`, written **only** by the server via the Admin SDK (which bypasses rules). Every session-scoped rule authorises against that one field.

```
Postgres (source of truth)
  Session.therapistId ─┐
  Session.clientId ────┴─→ provisionSessionDocs()  [Admin SDK]
                              └─→ liveSessions/{id}.allowedUids
                                    └─→ read by firestore.rules
```

## 4. Before / after

| Actor | Action | Before | After |
|---|---|---|---|
| Therapist in the session | Read/write room, session, diary, module state | ✅ | ✅ |
| Client in the session | Read/write room, session, module state | ✅ | ✅ |
| **Unrelated signed-in user** | Read another patient's transcript | **✅ allowed** | ❌ denied |
| **Unrelated signed-in user** | Read another patient's attention scores | **✅ allowed** | ❌ denied |
| **Unrelated signed-in user** | Write consent on someone's behalf | **✅ allowed** | ❌ denied |
| **Unrelated signed-in user** | Read/modify any module state | **✅ allowed** | ❌ denied |
| **Any therapist** | Read any patient's quests | **✅ allowed** | ⚠️ still allowed — see §7 |
| Participant | Grant themselves entitlement (`allowedUids`) | **✅ allowed** | ❌ denied |
| Participant | Create a room document | **✅ allowed** | ❌ denied (server-only) |
| Participant | Edit or delete a diary entry | **✅ allowed** | ❌ denied (append-only) |
| Participant | Write a malformed/oversized diary entry | **✅ allowed** | ❌ denied (schema-validated) |
| Anonymous visitor | Anything | ❌ denied | ❌ denied |
| Anyone | Access an unlisted collection | **✅ allowed** | ❌ denied (default deny) |

The diary is **append-only and schema-validated**: `type` must be `attention` or `transcript`, an attention `value` must be an integer 0–100, no extra fields may be smuggled in (a test asserts a `rawFrame` field is rejected), and update/delete are refused outright. Clinical observation data should not be rewritable after the fact.

## 5. Code changes required by the new rules

These ship **with** the rules, not before or after:

| File | Change | Safe to deploy early? |
|---|---|---|
| `src/lib/session-provisioning.ts` | **New.** Admin-SDK provisioning; writes `allowedUids` from Postgres | ✅ Yes — additive |
| `src/app/api/sessions/[sessionId]/route.ts` | Calls provisioning on `start`/`end` | ✅ Yes — additive |
| `src/app/api/users/profile/route.ts` | Mints `role` custom claim on signup | ✅ Yes — additive |
| `scripts/backfill-role-claims.mjs` | **New.** Backfills claims for existing users | ✅ Yes — run early |
| `src/app/session/[sessionId]/page.tsx` | Join flow no longer creates documents; provisions server-side first | ❌ **No** — must ship with the rules |

The page change is the only one that is not backward-compatible in both directions: it depends on the server having provisioned `allowedUids`, and the new rules depend on the page no longer creating documents.

## 6. What breaks if a step is missed

Ordered by severity:

1. **Deploy rules without running the claims backfill** → every therapist loses access to `patients/{uid}`. MicroQuestBoard silently shows an empty quest list. Claims only reach the browser on token refresh (up to 1 hour, or a re-login), so **run the backfill well in advance**, not at deploy time.
2. **Deploy rules without the provisioning code** → *total lockout*. No session has `allowedUids`, `isSessionMember()` is false for everyone, and **no one can join any session**. This is the catastrophic ordering failure.
3. **Deploy rules without the page change** → the browser still tries to create room documents, `allow create: if false` refuses, and joins fail for any session not already provisioned.
4. **Existing sessions are never re-provisioned** → any `liveSessions` document predating this work has no `allowedUids` and its participants are locked out. A one-off backfill over existing documents is needed, or rely on the fact that provisioning runs on every join (`PATCH start`) — which repairs a session the moment someone opens it. **Recommended: verify with a real historical session before trusting this.**
5. **A new collection is added later without a rule** → default-deny refuses it. This fails closed and is intentional, but it will look like a mysterious permission error to whoever adds it.

### Recommended deployment order

1. Ship the additive server code (provisioning, claim minting) — no behaviour change under current rules.
2. Run `npm run rules:backfill-claims -- --dry-run`, then for real.
3. Wait ≥1 hour (or force re-login) so claims propagate into ID tokens.
4. Open one real historical session to confirm provisioning repairs it.
5. Run the emulator suite green.
6. Deploy rules + the page change **together**.
7. Smoke-test a live two-party session immediately.

Rollback is `firebase deploy --only firestore:rules` against the previous ruleset, which is retained in the console.

## 7. Known residual gaps

- **`patients/{uid}` is therapist-wide.** Any account with the `THERAPIST` role claim can read any patient's quests, not only their own patients. This is a large improvement on "any authenticated user", but it is not the end state. Closing it needs an explicit `therapistUids` assignment list on the document, seeded from Postgres the same way `allowedUids` is.
- **No API route verifies Firebase ID tokens.** `verifyIdToken` appears nowhere in the codebase. `/api/users/profile` accepts an arbitrary `uid` in the POST body, so the REST API trusts client-supplied identity. Firestore rules do not protect these routes. **This is a separate vulnerability of comparable severity and is not addressed here.**
- **`aiConsent` is writable by either participant.** A participant can currently set the other side's consent flag. Tightening this needs a per-role field check.

## 8. Verification status

| Check | Status |
|---|---|
| Rules syntax compiles | ❌ **Not verified** |
| Emulator test suite passes | ❌ **Not run** |
| TypeScript (`tsc --noEmit`) | ✅ Clean |
| Production build | ✅ Passes |

The Firestore emulator requires a Java runtime, which is not installed on this machine (`Could not spawn 'java -version'`). The server-side fallback — the Firebase Rules API `:test` endpoint, which compiles and evaluates rules without deploying — returned `PERMISSION_DENIED`: the service account lacks `firebaserules.rulesets.test`.

**So the rules in this repository are written but unvalidated.** The 41-case suite in `tests/firestore-rules.test.ts` is complete and ready to run:

```bash
npm run test:rules   # starts the emulator, runs the suite, shuts it down
```

Nothing here should reach production until that command passes.
