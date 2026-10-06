import { doc, setDoc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SessionState } from '@/types';

// Listen to session synchronization
export function subscribeToSession(sessionId: string, onUpdate: (session: SessionState) => void) {
  const docRef = doc(db, 'liveSessions', sessionId);
  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      onUpdate(snapshot.data() as SessionState);
    }
  });
}

// Update the session room's active therapy module
export async function updateSessionModule(sessionId: string, moduleId: string | null) {
  const docRef = doc(db, 'liveSessions', sessionId);
  await updateDoc(docRef, {
    activeModuleId: moduleId,
    'timestamps.updatedAt': new Date().toISOString()
  });
}

// Sync specific state updates from therapist/client inside active module
export function subscribeToModuleState(sessionId: string, moduleId: string, onUpdate: (state: any) => void) {
  const docRef = doc(db, 'moduleStates', `${sessionId}_${moduleId}`);
  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      onUpdate(snapshot.data()?.state);
    }
  });
}

export async function updateModuleState(sessionId: string, moduleId: string, state: any, updatedBy: string) {
  const docRef = doc(db, 'moduleStates', `${sessionId}_${moduleId}`);
  await setDoc(docRef, {
    state,
    updatedBy,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

// Initialize liveSession document if not exists
export async function initLiveSession(sessionId: string, therapistUid: string, clientUid: string) {
  const docRef = doc(db, 'liveSessions', sessionId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    await setDoc(docRef, {
      sessionId,
      activeModuleId: null,
      participants: {
        [therapistUid]: { uid: therapistUid, name: 'Therapist', role: 'therapist', isOnline: true },
        [clientUid]: { uid: clientUid, name: 'Client', role: 'client', isOnline: false }
      },
      timestamps: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  }
}
