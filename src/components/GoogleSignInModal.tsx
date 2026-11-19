import React, { useState } from 'react';
import { Disc3, Loader2, X } from 'lucide-react';
import { useArchiveTune } from '../context/ArchiveTuneContext';

export const GoogleSignInModal: React.FC = () => {
  const {
    showGoogleSignInModal,
    setShowGoogleSignInModal,
    signInWithGoogleAccount,
    setShowSpotifyModal,
  } = useArchiveTune();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!showGoogleSignInModal) return null;

  const handleGoogleSignIn = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    const res = await signInWithGoogleAccount();
    setLoading(false);
    if (res.ok) {
      setShowGoogleSignInModal(false);
    } else {
      setError(res.message || 'Sign-in was cancelled or blocked by the browser.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in with Google"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="at-glass-card w-full max-w-md rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow shrink-0">
              <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
            </span>
            <div>
              <h2 className="text-base font-bold">Sign in with Google</h2>
              <p className="text-xs text-[var(--md-on-surface-variant)]">
                Choose your Google account to personalize your ArchiveTune profile
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowGoogleSignInModal(false)}
            aria-label="Close Google sign-in dialog"
            className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[var(--md-on-surface-variant)] leading-relaxed">
          Clicking below opens Google&apos;s account picker in one click. You can also import any
          YouTube Music or Spotify playlist by link without signing in.
        </p>

        {error && (
          <div className="rounded-xl px-3.5 py-2.5 text-xs bg-red-500/15 text-red-300 border border-red-500/30">
            {error}
          </div>
        )}

        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleGoogleSignIn()}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white text-[#1f1f1f] hover:bg-neutral-100 text-xs font-semibold shadow transition-colors disabled:opacity-60 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#4285F4]" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
            )}
            <span>{loading ? 'Opening Google Account Picker...' : 'Sign in with Google'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowGoogleSignInModal(false);
              setShowSpotifyModal(true);
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] text-[var(--md-on-surface)] cursor-pointer"
          >
            <Disc3 className="w-3.5 h-3.5 text-[var(--md-primary)]" />
            <span>Import Playlist by Link Without Sign-In</span>
          </button>

          <button
            type="button"
            onClick={() => setShowGoogleSignInModal(false)}
            className="w-full px-4 py-2 rounded-xl text-xs font-semibold text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
