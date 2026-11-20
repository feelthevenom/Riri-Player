import React, { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { signInWithGooglePopup } from '../utils/googleAuth';

interface DesktopAuthBridgeProps {
  callbackPort: string;
}

export const DesktopAuthBridge: React.FC<DesktopAuthBridgeProps> = ({ callbackPort }) => {
  const [status, setStatus] = useState<'idle' | 'signing_in' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [signedInName, setSignedInName] = useState<string>('');

  const handleContinue = async () => {
    setStatus('signing_in');
    setMessage('');
    try {
      const auth = await signInWithGooglePopup();
      const targetPort = Number(callbackPort);
      if (!Number.isInteger(targetPort) || targetPort < 1024 || targetPort > 65535) {
        throw new Error('Invalid desktop callback port.');
      }

      const resp = await fetch(`http://127.0.0.1:${targetPort}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          uid: auth.uid,
          name: auth.displayName,
          email: auth.email,
          avatarUrl: auth.photoURL,
          accessToken: auth.accessToken,
        }),
      });

      if (!resp.ok) {
        throw new Error('Could not return sign-in result to Riri Player desktop.');
      }

      setSignedInName(auth.displayName);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setMessage(
        err instanceof Error ? err.message : 'Google sign-in was cancelled or blocked.',
      );
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#121011] text-[#f4eff0] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#1c181a] p-8 shadow-2xl space-y-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#ED5564] text-white flex items-center justify-center font-bold text-xl shadow-lg">
          RP
        </div>

        {status === 'done' ? (
          <div className="space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <h1 className="text-xl font-bold">Signed in as {signedInName}</h1>
            <p className="text-sm text-white/70">
              Riri Player Desktop is importing your profile, playlists, and Liked Music. You can
              close this browser tab and return to the app.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold">Sign in to Riri Player</h1>
              <p className="text-sm text-white/70">
                Choose one of your browser&apos;s Google accounts to sign in with your Google profile
                and avatar automatically.
              </p>
            </div>

            {message && (
              <div className="rounded-xl px-4 py-3 text-xs bg-red-500/15 text-red-300 border border-red-500/30">
                {message}
              </div>
            )}

            <button
              type="button"
              disabled={status === 'signing_in'}
              onClick={() => void handleContinue()}
              className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl bg-white text-[#1f1f1f] hover:bg-neutral-100 font-semibold text-sm shadow transition-colors cursor-pointer disabled:opacity-60"
            >
              {status === 'signing_in' ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#4285F4]" />
              ) : (
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
              )}
              <span>
                {status === 'signing_in' ? 'Waiting for Google...' : 'Continue with Google'}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
