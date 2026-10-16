import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBwMuFR8DnpTVVqHD7TVjYVh50_e9FNaiE",
  authDomain: "staad-edtech.firebaseapp.com",
  databaseURL: "https://staad-edtech-default-rtdb.firebaseio.com",
  projectId: "staad-edtech",
  storageBucket: "staad-edtech.firebasestorage.app",
  messagingSenderId: "951372940788",
  appId: "1:951372940788:web:51ae0f6cef8e7df7db25a1"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

export { app, auth, db, rtdb };
