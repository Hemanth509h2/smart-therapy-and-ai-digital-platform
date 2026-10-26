import { getFirestore } from 'firebase/firestore';
import { app } from '@/lib/firebase';

// Firestore (live session state, notes, module sync). Kept apart from
// lib/firebase.ts so only the pages that use it load the Firestore SDK.
export const db = getFirestore(app);
