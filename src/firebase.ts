import { initializeApp, type FirebaseApp } from 'firebase/app'

/**
 * Firebase is configured from VITE_FIREBASE_* variables (see .env.example).
 * Until they are set, the app runs on sample data only.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId)

export const firebaseApp: FirebaseApp | null = firebaseConfigured ? initializeApp(config) : null
