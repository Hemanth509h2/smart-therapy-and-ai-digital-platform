import { Router } from 'express';
import { handle } from '@/lib/http/reply';
import { getMeasurement } from '@/lib/progress/measurement/measurementController.js';
import { getReport } from '@/lib/progress/reports/reportController.js';

export const router = Router();

router.get('/progress-features/measurement/:clientId', handle(getMeasurement));
router.get('/progress-features/reports/:clientId', handle(getReport));
