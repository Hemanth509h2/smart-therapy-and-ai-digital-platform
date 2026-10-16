// Next.js requires an API route file to physically exist at this path to
// register the endpoint — this file just re-exports the real handler from
// src/lib/progress/, so the actual logic lives in one place.
export { GET } from '@/lib/progress/measurement/measurementController.js';
