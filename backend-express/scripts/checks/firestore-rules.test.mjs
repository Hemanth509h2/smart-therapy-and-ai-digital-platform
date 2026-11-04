// Firestore security rules tests, run against the local emulator:
//
//   npx firebase emulators:exec --only firestore --project staad-rules-test \
//     "node scripts/checks/firestore-rules.test.mjs"
//
// Talks to the emulator's REST API: seeds documents as the "owner" (bypasses
// rules) and acts as users with unsigned ID tokens, which the emulator accepts.
// Exits non-zero if any expectation fails.

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT || 'staad-rules-test';
const BASE = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: 'custom', identities: {} },
    ...claims,
  })}.`;
}

// Plain JS -> Firestore REST value.
function v(x) {
  if (x === null) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(v) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, v(y)])) } };
}
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, y]) => [k, v(y)]));

async function call(method, path, auth, body, mask) {
  const qs = mask ? '?' + mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&') : '';
  const res = await fetch(`${BASE}/${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ fields: fields(body) }) : undefined,
  });
  return res.status;
}
const seed = (path, data) => call('PATCH', path, 'owner', data);
// A partial update, like updateDoc(): only the listed field paths change.
const update = (path, auth, data, mask) => call('PATCH', path, auth, data, mask ?? Object.keys(data));
const get = (path, auth) => call('GET', path, auth);

let failed = 0;
async function expect(name, promise, allowed) {
  const status = await promise;
  // A permitted read of a missing document answers 404, not 403.
  const ok = allowed ? status === 200 || status === 404 : status === 403;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (HTTP ${status}, expected ${allowed ? 'allowed' : 'denied'})`);
}

const THERAPIST = token('t1', { role: 'THERAPIST' });
const OTHER_THERAPIST = token('t2', { role: 'THERAPIST' });
const CLIENT = token('c1', { role: 'CLIENT' });
const GUEST = token('g1');

await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await seed('liveSessions/s1', { sessionId: 's1', allowedUids: ['t1', 'c1', 'g1'] });
await seed('liveSessions/s2', { sessionId: 's2', allowedUids: ['t2', 'x9'] });
await seed('sessions/s1', {
  sessionId: 's1',
  aiConsent: {},
  transcript: [{ text: 'hello' }],
  therapistNotes: [{ content: 'n1' }],
});

// sessions/{id}: consent
await expect('therapist sets own consent', update('sessions/s1', THERAPIST, { aiConsent: { therapist: true } }, ['aiConsent.therapist']), true);
await expect('client sets own consent', update('sessions/s1', CLIENT, { aiConsent: { client: true } }, ['aiConsent.client']), true);
await expect('guest sets the client consent', update('sessions/s1', GUEST, { aiConsent: { client: false } }, ['aiConsent.client']), true);
// (therapist is true at this point, so false is a real change)
await expect('client cannot set therapist consent', update('sessions/s1', CLIENT, { aiConsent: { therapist: false } }, ['aiConsent.therapist']), false);
await expect('therapist cannot set client consent', update('sessions/s1', THERAPIST, { aiConsent: { client: true } }, ['aiConsent.client']), false);
await expect('consent must be a boolean', update('sessions/s1', CLIENT, { aiConsent: { client: 'yes' } }, ['aiConsent.client']), false);

// sessions/{id}: fields
await expect('client appends to transcript', update('sessions/s1', CLIENT, { transcript: [{ text: 'hello' }, { text: 'hi' }] }), true);
await expect('client cannot erase the transcript', update('sessions/s1', CLIENT, { transcript: [] }), false);
await expect('therapist adds a note', update('sessions/s1', THERAPIST, { therapistNotes: [{ content: 'n1' }, { content: 'n2' }] }), true);
await expect('client cannot write therapist notes', update('sessions/s1', CLIENT, { therapistNotes: [{ content: 'n1' }, { content: 'x' }] }), false);
await expect('client cannot write the call plan', update('sessions/s1', CLIENT, { callPlan: { items: [] } }), false);
await expect('therapist writes the call plan', update('sessions/s1', THERAPIST, { callPlan: { items: [] } }), true);
await expect('nobody writes aiInsight from the browser', update('sessions/s1', THERAPIST, { aiInsight: { text: 'x' } }), false);
await expect('client draws on the whiteboard', update('sessions/s1', CLIENT, { whiteboardElements: '[]', whiteboardUpdatedBy: 'client', whiteboardUpdatedAt: 'now' }), true);
await expect('non-member cannot update', update('sessions/s1', OTHER_THERAPIST, { moduleEvents: [{ detail: 'x' }] }), false);
await expect('non-member cannot read', get('sessions/s1', OTHER_THERAPIST), false);

// patients/{uid}
await expect('therapist reads a missing patient doc', get('patients/c1', THERAPIST), true);
await expect('therapist creates via a shared session', update('patients/c1', THERAPIST, { quests: [], sessionId: 's1' }), true);
await expect('therapist reads via a shared session', get('patients/c1', THERAPIST), true);
await expect('patient reads own doc', get('patients/c1', CLIENT), true);
await expect('other therapist cannot read', get('patients/c1', OTHER_THERAPIST), false);
await expect('other therapist cannot write with own session', update('patients/c1', OTHER_THERAPIST, { quests: [], sessionId: 's2' }), false);
await expect('other therapist cannot write with the patient session', update('patients/c1', OTHER_THERAPIST, { quests: [], sessionId: 's1' }), false);
await expect('therapist cannot write without a session', update('patients/c9', THERAPIST, { quests: [] }), false);

// liveSessions/{id}: the writes the session page and modules make
const LS = 'liveSessions/s1';
const now = '2026-11-05T10:00:00.000Z';
await expect('therapist launches a module', update(LS, THERAPIST, { activeModuleId: 'maze', whiteboard: { active: false, shared: false }, timestamps: { updatedAt: now } }, ['activeModuleId', 'whiteboard', 'timestamps.updatedAt']), true);
await expect('therapist locks controls', update(LS, THERAPIST, { therapistControl: true }), true);
await expect('client cannot end the call', update(LS, CLIENT, { status: 'ended' }), false);
await expect('therapist ends the call', update(LS, THERAPIST, { status: 'ended', participants: { t1: { isOnline: false } } }, ['status', 'participants.t1.isOnline']), true);
await expect('client writes module state', update(LS, CLIENT, { moduleState: { wbChecked: [1, 2] }, timestamps: { updatedAt: now } }, ['moduleState.wbChecked', 'timestamps.updatedAt']), true);
await expect('guest sends a reaction', update(LS, GUEST, { lastReaction: { emoji: '👏', timestamp: now } }), true);
await expect('client marks self online', update(LS, CLIENT, { participants: { c1: { uid: 'c1', name: 'Asha', role: 'client', isOnline: true, lastSeen: now } } }, ['participants.c1']), true);
await expect('client cannot launch a module', update(LS, CLIENT, { activeModuleId: 'simon_says' }), false);
await expect('client cannot unlock controls', update(LS, CLIENT, { therapistControl: false }), false);
await expect('client cannot open the whiteboard', update(LS, CLIENT, { whiteboard: { active: true, shared: true } }), false);
await expect('client cannot edit the therapist entry', update(LS, CLIENT, { participants: { t1: { isOnline: true } } }, ['participants.t1.isOnline']), false);
await expect('client cannot claim the therapist role', update(LS, CLIENT, { participants: { c1: { uid: 'c1', name: 'X', role: 'therapist', isOnline: true } } }, ['participants.c1']), false);
await expect('member cannot add itself to allowedUids', update(LS, CLIENT, { allowedUids: ['t1', 'c1', 'g1', 'z9'] }), false);
await expect('member cannot write unknown fields', update(LS, CLIENT, { evil: 'x' }), false);
await expect('oversized reaction is refused', update(LS, CLIENT, { lastReaction: { emoji: 'x'.repeat(50), timestamp: now } }), false);
await expect('non-member cannot update the room', update(LS, OTHER_THERAPIST, { moduleState: { a: 1 } }, ['moduleState.a']), false);

// moduleStates/{sessionId}_{moduleId}
await expect('member saves module state', update('moduleStates/s1_maze', CLIENT, { state: { pos: 3 }, updatedBy: 'c1', updatedAt: now }), true);
await expect('anonymous writer label allowed', update('moduleStates/s1_maze', GUEST, { state: { pos: 4 }, updatedBy: 'anonymous', updatedAt: now }), true);
await expect('cannot write as someone else', update('moduleStates/s1_maze', CLIENT, { state: { pos: 5 }, updatedBy: 't1', updatedAt: now }), false);
await expect('cannot add other fields', update('moduleStates/s1_maze', CLIENT, { state: { pos: 5 }, updatedBy: 'c1', updatedAt: now, extra: true }), false);
await expect('state must be a map', update('moduleStates/s1_calc', CLIENT, { state: 'eval(1)', updatedBy: 'c1', updatedAt: now }), false);
await expect('non-member cannot write module state', update('moduleStates/s1_maze', OTHER_THERAPIST, { state: {}, updatedBy: 't2', updatedAt: now }), false);

console.log(failed ? `\n${failed} rule test(s) failed` : '\nAll rule tests passed');
process.exit(failed ? 1 : 0);
