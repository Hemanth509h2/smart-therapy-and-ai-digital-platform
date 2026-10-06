# Security Report — Simple Version (2026-10-06)

## In one line
**Anyone on the internet can currently do almost anything to the platform — no password needed.**

## The 5 scariest problems

1. **Anyone can become admin.**
   Sending one request (`POST /api/admin/admins` with any email+password) creates an admin account. Game over.

2. **Anyone can watch live therapy video calls.**
   The video-token endpoint asks no questions and even gives "admin" rights if you just ask for them in the URL.

3. **Anyone can read all patient data.**
   Names, diagnoses, phone numbers, clinical notes, AI reports — several URLs just hand them out, no login checked.

4. **Invite links can be stolen.**
   One open URL lists all invite links of a therapist, and links never expire → a stranger can join a patient's session pretending to be the patient, forever.

5. **Anyone can spend your money.**
   The speech-to-text relay, AI reports, and WhatsApp sending have no login checks → strangers run up your Sarvam/Deepgram/OpenAI/Twilio bills.

## Plus
- A calculator module runs `eval()` on data from the other person in the call → they can run code in your browser.
- Old passwords/keys were once committed to git → **all secrets should be rotated** (Neon, Firebase, Twilio, LiveKit, Sarvam, etc.).
- `AUTH_DISABLED=true` is set for local dev. **Never deploy with it** — it turns off login checks everywhere.

## What's already fixed ✅
- Login/profile API now really verifies the Firebase token (the original bug you reported).
- Invite creation, STT tokens, WhatsApp invite, progress routes now verify tokens.
- Token is sent automatically with every API call from the frontend.

## What to do, in order

**Do now (P0):**
1. Put login checks on all `/api/admin/*` routes (admin role required)
2. Put login checks on the video-token endpoint — decide room/role on the server
3. Put login checks on patient-data routes (clients, sessions, notes, reports…)
4. Remove `eval()` from the calculator module
5. Require login to list invites + make invites expire
6. Rotate all secrets/keys

**Do soon (P1):** lock the speech relay + Deepgram with token checks, protect session start/end, tighten Firestore rules, add rate limiting.

Full technical details with file locations: `SECURITY_AUDIT_2026-10-06_v2.md`
