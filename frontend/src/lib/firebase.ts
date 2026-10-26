import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// NOTE: the Firebase *web* config is public by design — it identifies the
// project but grants no access. Security is enforced by Firestore rules
// and by the backend verifying Firebase ID tokens (see lib/api.ts and the
// backend's lib/apiAuth.ts). The values live in env vars so different
// deployments can point at different Firebase projects.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// Firestore lives in lib/firestore.ts, so pages that only need sign-in don't
// download it.
export { app, auth };
