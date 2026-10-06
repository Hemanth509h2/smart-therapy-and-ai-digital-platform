import { auth } from '@/lib/firebase';

/**
 * Wraps `fetch` and attaches the signed-in therapist's Firebase ID token as
 * `Authorization: Bearer <token>`. All /api/progress/* routes require this.
 */
export async function progressFetch(input: string, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to access progress tracking.');
  }
  const token = await user.getIdToken();

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(input, { ...init, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(message);
  }
  return res.json();
}

export interface ProgressMetric {
  id: string;
  clientId: string;
  therapistId: string;
  sessionId: string | null;
  metricType: string;
  value: number;
  unit: string | null;
  notes: string | null;
  recordedAt: string;
  createdAt: string;
}

export interface ProgressNote {
  id: string;
  clientId: string;
  therapistId: string;
  reportId: string | null;
  content: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressReport {
  id: string;
  clientId: string;
  therapistId: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  summary: string;
  metricsSnapshot: Record<string, { average: number; count: number }>;
  status: 'DRAFT' | 'FINAL';
  createdAt: string;
  updatedAt: string;
}

export const fetchClientMetrics = (clientId: string, metricType?: string) =>
  progressFetch(
    `/api/progress/metrics?clientId=${encodeURIComponent(clientId)}${
      metricType ? `&metricType=${encodeURIComponent(metricType)}` : ''
    }`
  ).then((d) => d.metrics as ProgressMetric[]);

export const createMetric = (payload: {
  clientId: string;
  sessionId?: string;
  metricType: string;
  value: number;
  unit?: string;
  notes?: string;
  recordedAt?: string;
}) =>
  progressFetch('/api/progress/metrics', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((d) => d.metric as ProgressMetric);

export const updateMetric = (
  id: string,
  payload: Partial<Pick<ProgressMetric, 'value' | 'unit' | 'notes' | 'metricType' | 'recordedAt'>>
) =>
  progressFetch(`/api/progress/metrics/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }).then((d) => d.metric as ProgressMetric);

export const fetchClientNotes = (clientId: string) =>
  progressFetch(`/api/progress/notes?clientId=${encodeURIComponent(clientId)}`).then(
    (d) => d.notes as ProgressNote[]
  );

export const createNote = (payload: { clientId: string; content: string; reportId?: string; isPrivate?: boolean }) =>
  progressFetch('/api/progress/notes', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((d) => d.note as ProgressNote);

export const fetchClientReports = (clientId: string) =>
  progressFetch(`/api/progress/reports?clientId=${encodeURIComponent(clientId)}`).then(
    (d) => d.reports as ProgressReport[]
  );

export const createReport = (payload: {
  clientId: string;
  title?: string;
  periodStart: string;
  periodEnd: string;
  summary: string;
  status?: 'DRAFT' | 'FINAL';
}) =>
  progressFetch('/api/progress/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then((d) => d.report as ProgressReport);
