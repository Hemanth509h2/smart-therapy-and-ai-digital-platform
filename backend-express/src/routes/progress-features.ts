import { Router, type NextFunction, type Request, type Response } from 'express';
import { handle, send } from '@/lib/http/reply';
import { requireTherapist } from '@/lib/http/progressAuth';
import { clientOfTherapist } from '@/lib/core/ownership';
import { getMeasurement } from '@/lib/progress/measurement/measurementController.js';
import { getReport } from '@/lib/progress/reports/reportController.js';

export const router = Router();

// Both return a client's progress data, so only that client's own therapist
// may call them. A client that isn't theirs gets the same 404 as one that
// doesn't exist, so client ids can't be probed.
async function ownClientOnly(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = await requireTherapist(req);
    if (!auth.ok) return send(res, auth.response);
    if (!(await clientOfTherapist(auth.therapist.id, req.params.clientId))) {
      return res.status(404).json({ error: 'Client not found' });
    }
    next();
  } catch (e) {
    next(e);
  }
}

router.get('/progress-features/measurement/:clientId', ownClientOnly, handle(getMeasurement));
router.get('/progress-features/reports/:clientId', ownClientOnly, handle(getReport));
