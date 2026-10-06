// Next.js requires an API route file to physically exist at this path to
// register the endpoint — this file just re-exports the real handler from
// progress_features/, so the actual logic lives in one place.
export { GET } from '@/progress_features/backend/measurement/measurementController.js';
