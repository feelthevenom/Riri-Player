import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';

/**
 * Developer Note on `firebase-applet-config.json`:
 * - Firebase is OPTIONAL in Riri Player (only needed if you want Firebase-backed Google Sign-In).
 * - Public repositories MUST NOT commit real `firebase-applet-config.json` files.
 * - Option A: Place your private `firebase-applet-config.json` inside `/config/firebase/`
 *   (all `*.json` files there are gitignored except `firebase-applet-config.example.json`,
 *   and `.gitkeep` keeps the folder tracked).
 * - Option B: Provide `VITE_FIREBASE_*` environment variables (see `.env.example`).
 */
interface OptionalFirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

const optionalConfigModules = import.meta.glob<{ default?: OptionalFirebaseConfig }>(
  '../../config/firebase/firebase-applet-config.json',
  { eager: true },
);
const fileFirebaseConfig: OptionalFirebaseConfig =
  Object.values(optionalConfigModules)[0]?.default || {};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || fileFirebaseConfig.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || fileFirebaseConfig.authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || fileFirebaseConfig.projectId || '',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || fileFirebaseConfig.storageBucket || '',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    fileFirebaseConfig.messagingSenderId ||
    '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fileFirebaseConfig.appId || '',
};

function getFirebaseAuth(): Auth | null {
  if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
    return null;
  }
  try {
    const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    return getAuth(app);
  } catch {
    return null;
  }
}

function buildGoogleProvider(includeYoutubeScope = true): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  if (includeYoutubeScope) {
    provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
  }
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  return provider;
}

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
  const auth = getFirebaseAuth();
  if (!auth) {
    return () => {};
  }
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
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error(
      'Google Sign-In is not configured in this build. Use Desktop sign-in or import playlists directly.',
    );
  }
  isSigningIn = true;
  try {
    let result;
    try {
      result = await signInWithPopup(auth, buildGoogleProvider(true));
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/unauthorized-domain'
      ) {
        throw err;
      }
      // Retry basic openid/profile/email sign-in if youtube.readonly scope wasn't permitted
      result = await signInWithPopup(auth, buildGoogleProvider(false));
    }
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
  const auth = getFirebaseAuth();
  if (!auth) return;
  await signOut(auth).catch(() => undefined);
}
