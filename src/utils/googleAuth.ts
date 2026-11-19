import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

function getFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

const app = getFirebaseApp();
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: 'select_account',
});

// Keep any OAuth credential token strictly in memory (never localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export interface GoogleAuthResult {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  accessToken: string;
}

export function getCachedGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export function setDesktopGoogleAccessToken(token: string | null): void {
  cachedAccessToken = token;
}

export function initGoogleAuth(
  onAuthUser?: (user: User, token: string | null) => void,
  onSignedOut?: () => void,
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (onAuthUser) onAuthUser(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      if (onSignedOut) onSignedOut();
    }
  });
}

export async function signInWithGooglePopup(): Promise<GoogleAuthResult> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken || '';
    if (accessToken) {
      cachedAccessToken = accessToken;
    }
    return {
      uid: result.user.uid,
      displayName: result.user.displayName || result.user.email || 'Google User',
      email: result.user.email || '',
      photoURL: result.user.photoURL || '',
      accessToken,
    };
  } finally {
    isSigningIn = false;
  }
}

export async function signOutGoogleFirebase(): Promise<void> {
  cachedAccessToken = null;
  await signOut(auth).catch(() => undefined);
}
