import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type Auth,
  type User
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets'
] as const;

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let isSigningIn = false;
// Strictly in-memory OAuth access token (never localStorage or sessionStorage)
let cachedAccessToken: string | null = null;

function getFirebaseAuthInstance(): Auth {
  if (!firebaseApp) {
    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  if (!firebaseAuth) {
    firebaseAuth = getAuth(firebaseApp);
  }
  return firebaseAuth;
}

function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_SHEETS_SCOPES) {
    provider.addScope(scope);
  }
  return provider;
}

export function initGoogleSheetsAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthRequired?: () => void
): () => void {
  const auth = getFirebaseAuthInstance();
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthRequired?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthRequired?.();
    }
  });
}

export async function googleSheetsSignIn(): Promise<{ user: User; accessToken: string }> {
  const auth = getFirebaseAuthInstance();
  const provider = createGoogleProvider();
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve Google Sheets access token.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleSheetsAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearGoogleSheetsAccessToken(): void {
  cachedAccessToken = null;
}

export async function googleSheetsSignOut(): Promise<void> {
  const auth = getFirebaseAuthInstance();
  cachedAccessToken = null;
  await auth.signOut();
}
