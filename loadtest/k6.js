// =============================================================================
// STAAD - load test (k6)
// =============================================================================
//
// What this tests:
//   visitors    website pages, the public plans API, backend and AI /health.
//               No sign-in needed.
//   therapists  the signed-in dashboard's API reads: profile, module settings,
//               sessions, clients, subscription. Runs only when TOKEN is set.
//
// What it leaves out on purpose (they cost money or message real people):
//   AI insights / reports / call plan (OpenRouter), speech-to-text (Sarvam),
//   WhatsApp, payments, LiveKit video. Nothing is written to the database.
//
// How to run (no install: uses the k6 Docker image; run from the repo root):
//   sudo docker run --rm -i --network host \
//     -e PROFILE=smoke \
//     grafana/k6:0.57.0 run - < loadtest/k6.js
//
//   --network host  lets k6 reach services on this machine's localhost.
//   PROFILE         smoke (start here) | load | stress | spike, see PROFILES.
//
// Where it sends requests (defaults: services started with `docker run -p`):
//   APP_URL  website      default http://localhost:3000
//   API_URL  backend      default http://localhost:4000
//   AI_URL   AI service   default http://localhost:4100
//   Behind Caddy (docker compose), set all three to https://APP_DOMAIN.
//
// Signed-in requests (optional):
//   TOKEN    a therapist's Firebase ID token. Sign in to the website as a TEST
//            therapist, open DevTools > Network, click any /api/ request and
//            copy the value after "Bearer " in its Authorization header.
//            It expires after one hour.
//   e.g. -e TOKEN=eyJhbGciOi...
//
// Reading the result:
//   http_req_duration  p(95) is the time 95% of requests finished within.
//   http_req_failed    share of requests that errored or got a non-2xx/3xx.
//   A ✗ next to a threshold at the end means that target was missed.
//   Run k6 on a different machine from the server when you can: on the same
//   machine they compete for CPU and the numbers look worse than they are.
// =============================================================================

import http from 'k6/http';
import { check, fail, group, sleep } from 'k6';

const APP = (__ENV.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const API = (__ENV.API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const AI = (__ENV.AI_URL || 'http://localhost:4100').replace(/\/+$/, '');
const TOKEN = __ENV.TOKEN || '';
const PROFILE = __ENV.PROFILE || 'smoke';

// Virtual users (each one a person clicking around) over time.
const PROFILES = {
  // A few users for 30s: checks the script and the URLs work.
  smoke: [{ duration: '30s', target: 3 }],
  // Normal busy day: ramp to 20 users, hold, ramp down.
  load: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 20 },
    { duration: '1m', target: 0 },
  ],
  // Keep adding users to find where it starts to slow down or fail.
  stress: [
    { duration: '2m', target: 50 },
    { duration: '3m', target: 100 },
    { duration: '3m', target: 200 },
    { duration: '2m', target: 0 },
  ],
  // Sudden rush, e.g. everyone opening the app at the top of the hour.
  spike: [
    { duration: '20s', target: 5 },
    { duration: '10s', target: 150 },
    { duration: '1m', target: 150 },
    { duration: '20s', target: 0 },
  ],
};

if (!PROFILES[PROFILE]) {
  throw new Error(`Unknown PROFILE "${PROFILE}". Use one of: ${Object.keys(PROFILES).join(', ')}`);
}

export const options = {
  scenarios: {
    visitors: { executor: 'ramping-vus', stages: PROFILES[PROFILE], exec: 'visitor' },
    ...(TOKEN ? { therapists: { executor: 'ramping-vus', stages: PROFILES[PROFILE], exec: 'therapist' } } : {}),
  },
  // Targets. Adjust them to what you need; a missed one makes k6 exit non-zero.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:page}': ['p(95)<2000'],
    'http_req_duration{kind:api}': ['p(95)<1000'],
    'http_req_duration{kind:health}': ['p(95)<300'],
  },
};

// Runs once before the test: checks every service answers, and finds the
// signed-in therapist's id for the API reads that need it.
export function setup() {
  for (const [name, url] of [['website', `${APP}/`], ['backend', `${API}/`], ['AI service', `${AI}/health`]]) {
    const res = http.get(url, { timeout: '10s' });
    if (res.status === 0 || res.status >= 500) {
      fail(`${name} is not answering at ${url} (status ${res.status}). Check the URL and that the container is running.`);
    }
  }
  if (!TOKEN) return { therapistId: null };

  const res = http.get(`${API}/api/users/profile`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 401) fail('TOKEN was rejected (401). It expires after an hour: copy a fresh one.');
  const therapistId = res.json('user.therapist.id');
  if (!therapistId) fail('TOKEN does not belong to a therapist account. Sign in as a test therapist and copy its token.');
  return { therapistId };
}

const pause = () => sleep(1 + Math.random() * 2);

export function visitor() {
  group('website pages', () => {
    for (const path of ['/', '/auth', '/plans', '/privacy']) {
      const res = http.get(`${APP}${path}`, { tags: { kind: 'page', name: `page ${path}` } });
      check(res, { 'page loads': (r) => r.status === 200 });
      pause();
    }
  });

  group('public API', () => {
    const plans = http.get(`${API}/api/plans`, { tags: { kind: 'api', name: 'GET /api/plans' } });
    check(plans, { 'plans load': (r) => r.status === 200 });

    const backend = http.get(`${API}/`, { tags: { kind: 'health', name: 'backend /' } });
    check(backend, { 'backend ok': (r) => r.status === 200 });

    const ai = http.get(`${AI}/health`, { tags: { kind: 'health', name: 'AI /health' } });
    check(ai, { 'AI ok': (r) => r.status === 200 });
  });
  pause();
}

export function therapist(data) {
  const params = (name) => ({
    headers: { Authorization: `Bearer ${TOKEN}` },
    tags: { kind: 'api', name },
  });
  const id = data.therapistId;

  // Roughly what the dashboard loads when a therapist opens it.
  group('therapist dashboard', () => {
    const reads = [
      ['GET /api/users/profile', `${API}/api/users/profile`],
      ['GET /api/modules/settings', `${API}/api/modules/settings`],
      ['GET /api/sessions', `${API}/api/sessions?therapistId=${id}`],
      ['GET /api/clients', `${API}/api/clients?therapistId=${id}`],
      ['GET /api/subscriptions', `${API}/api/subscriptions?therapistId=${id}`],
    ];
    const responses = http.batch(reads.map(([name, url]) => ['GET', url, null, params(name)]));
    responses.forEach((res, i) => {
      check(res, { [`${reads[i][0]} ok`]: (r) => r.status === 200 });
      if (res.status === 401) fail('TOKEN expired during the test (401). Copy a fresh one and run again.');
    });
  });
  pause();
}
