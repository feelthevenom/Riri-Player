import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Settings,
  UserCircle2,
  Cookie,
  Key,
} from 'lucide-react';
import { useArchiveTune } from '../context/ArchiveTuneContext';

interface ProfileMenuProps {
  style?: React.CSSProperties;
  className?: string;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ style, className }) => {
  const {
    activeYtAccount,
    signingInGoogle,
    triggerGoogleSignIn,
    signOutGoogleAccount,
    syncYtMusicLibrary,
    updateYtAccountCookie,
    signInYtMusicAccount,
    navigate,
  } = useArchiveTune();

  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [visitorDataInput, setVisitorDataInput] = useState('');
  const [cookieInputLoading, setCookieInputLoading] = useState(false);
  const [ytMusicSignInLoading, setYtMusicSignInLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAvatarFailed(false);
  }, [activeYtAccount?.avatarUrl]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSignInClick = () => {
    setOpen(false);
    void triggerGoogleSignIn();
  };

  const handleSignOutClick = () => {
    setOpen(false);
    void signOutGoogleAccount();
  };

  const handleSyncClick = async () => {
    setSyncing(true);
    await syncYtMusicLibrary();
    setSyncing(false);
    setOpen(false);
  };

  const handleCookieInputSubmit = async () => {
    if (!activeYtAccount || !cookieInput.trim()) return;
    setCookieInputLoading(true);
    try {
      await updateYtAccountCookie(activeYtAccount.id, cookieInput.trim(), visitorDataInput.trim() || undefined);
      setShowCookieInput(false);
      setCookieInput('');
      setVisitorDataInput('');
    } catch (error) {
      console.error('Failed to update cookie:', error);
    } finally {
      setCookieInputLoading(false);
    }
  };

  const handleCookieInputOpen = () => {
    setShowCookieInput(true);
    setOpen(false);
  };

  const handleYtMusicSignIn = async () => {
    setYtMusicSignInLoading(true);
    setOpen(false);
    try {
      const electronApi = (window as unknown as { electronAPI?: { openYtMusicSignIn?: () => Promise<{ ok: boolean; cookie?: string; visitorData?: string; error?: string }> } }).electronAPI;
      if (!electronApi?.openYtMusicSignIn) {
        throw new Error('YouTube Music sign-in not available');
      }
      const res = await electronApi.openYtMusicSignIn();
      if (res.ok && res.cookie) {
        await signInYtMusicAccount(res.cookie, res.visitorData || '');
      } else {
        throw new Error(res.error || 'YouTube Music sign-in failed');
      }
    } catch (error) {
      console.error('YouTube Music sign-in failed:', error);
    } finally {
      setYtMusicSignInLoading(false);
    }
  };

  const initials = activeYtAccount?.name
    ? activeYtAccount.name
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join('')
        .toUpperCase()
    : 'U';

  return (
    <div ref={containerRef} className={`relative ${className || ''}`} style={style}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={activeYtAccount ? `User profile: ${activeYtAccount.name}` : 'Sign in or open profile menu'}
        className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-[var(--md-surface-container-high)]/80 hover:bg-[var(--md-surface-container-highest)] border border-[var(--md-outline-variant)]/40 text-[var(--md-on-surface)] transition-colors cursor-pointer"
      >
        {signingInGoogle ? (
          <Loader2 className="w-6 h-6 p-1 text-[var(--md-primary)] animate-spin shrink-0" />
        ) : activeYtAccount ? (
          activeYtAccount.avatarUrl && !avatarFailed ? (
            <img
              src={activeYtAccount.avatarUrl}
              alt={activeYtAccount.name}
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-[var(--md-primary)]/40"
            />
          ) : (
            <span className="w-6 h-6 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center font-bold text-[10px] shrink-0">
              {initials}
            </span>
          )
        ) : (
          <UserCircle2 className="w-6 h-6 text-[var(--md-on-surface-variant)] shrink-0" />
        )}

        <span className="hidden sm:inline max-w-[130px] truncate">
          {signingInGoogle
            ? 'Signing in...'
            : activeYtAccount
              ? activeYtAccount.name
              : 'Sign in'}
        </span>

        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--md-on-surface-variant)] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account and settings menu"
          className="absolute right-0 top-10 z-50 w-64 rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-high)] p-1.5 shadow-2xl text-xs"
        >
          {activeYtAccount ? (
            <>
              <div className="flex items-center gap-2.5 px-3 py-2.5 mb-1 border-b border-[var(--md-outline-variant)]/40">
                {activeYtAccount.avatarUrl && !avatarFailed ? (
                  <img
                    src={activeYtAccount.avatarUrl}
                    alt={activeYtAccount.name}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    className="w-9 h-9 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center font-bold text-xs shrink-0">
                    {initials}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate text-[var(--md-on-surface)]">
                    {activeYtAccount.name}
                  </div>
                  <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                    {activeYtAccount.handle || 'Google Account synced'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                role="menuitem"
                disabled={syncing}
                onClick={() => void handleSyncClick()}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-semibold hover:bg-[var(--md-surface-container-highest)] cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 text-[var(--md-primary)] ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Syncing Library...' : 'Sync Library'}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate('settings');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-semibold hover:bg-[var(--md-surface-container-highest)] cursor-pointer"
              >
                <Settings className="w-4 h-4 text-[var(--md-on-surface-variant)]" />
                <span>Settings</span>
              </button>

              {activeYtAccount.authProvider === 'google' && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleCookieInputOpen}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-semibold hover:bg-[var(--md-surface-container-highest)] cursor-pointer"
                  >
                    <Cookie className="w-4 h-4 text-[var(--md-primary)]" />
                    <span>Enter YouTube Music Cookie</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleYtMusicSignIn}
                    disabled={ytMusicSignInLoading}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-semibold hover:bg-[var(--md-primary-container)]/35 text-[var(--md-on-surface)] cursor-pointer disabled:opacity-60"
                  >
                    <Loader2 className={`w-4 h-4 text-[var(--md-primary)] ${ytMusicSignInLoading ? 'animate-spin' : 'hidden'}`} />
                    <LogIn className={`w-4 h-4 text-[var(--md-primary)] ${ytMusicSignInLoading ? 'hidden' : ''}`} />
                    <span>{ytMusicSignInLoading ? 'Opening YouTube Music...' : 'Sign in to YouTube Music (Auto)'}</span>
                  </button>
                </>
              )}

              <div className="my-1 border-t border-[var(--md-outline-variant)]/40" />

              <button
                type="button"
                role="menuitem"
                onClick={handleSignOutClick}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-semibold text-red-400 hover:bg-red-500/15 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign out</span>
              </button>
            </>
          ) : (
            <>
              <div className="px-3 py-2 mb-1 border-b border-[var(--md-outline-variant)]/40">
                <div className="font-bold text-[var(--md-on-surface)]">YouTube Music</div>
                <div className="text-[11px] text-[var(--md-on-surface-variant)] mt-0.5">
                  Sign in to sync your Liked Music, playlists, albums &amp; artists
                </div>
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={handleYtMusicSignIn}
                disabled={ytMusicSignInLoading}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left font-semibold hover:bg-[var(--md-primary-container)]/35 text-[var(--md-on-surface)] cursor-pointer disabled:opacity-60"
              >
                <Loader2 className={`w-4 h-4 text-[var(--md-primary)] ${ytMusicSignInLoading ? 'animate-spin' : 'hidden'}`} />
                <LogIn className={`w-4 h-4 text-[var(--md-primary)] ${ytMusicSignInLoading ? 'hidden' : ''}`} />
                <span>{ytMusicSignInLoading ? 'Opening YouTube Music...' : 'Sign in to YouTube Music'}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate('settings');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-semibold hover:bg-[var(--md-surface-container-highest)] cursor-pointer"
              >
                <Settings className="w-4 h-4 text-[var(--md-on-surface-variant)]" />
                <span>Settings</span>
              </button>
            </>
          )}

          {/* Cookie Input Modal */}
          {showCookieInput && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cookie-input-title"
            >
              <div className="at-glass-card w-full max-w-md rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-6 shadow-2xl">
                <h2 id="cookie-input-title" className="text-lg font-bold mb-4 text-[var(--md-on-surface)]">
                  Enter YouTube Music Cookie
                </h2>
                <p className="text-sm text-[var(--md-on-surface-variant)] mb-4">
                  Paste your YouTube Music cookie to enable full library sync (Liked Songs, Playlists, Albums, Artists, Uploads).
                  <br />
                  <span className="text-xs">Get it from DevTools → Application → Cookies → music.youtube.com → SAPISID / __Secure-3PAPISID</span>
                </p>

                <div className="space-y-3 mb-4">
                  <label className="block text-xs font-semibold text-[var(--md-on-surface-variant)] mb-1">
                    Cookie (SAPISID or __Secure-3PAPISID)
                  </label>
                  <textarea
                    value={cookieInput}
                    onChange={(e) => setCookieInput(e.target.value)}
                    placeholder="SAPISID=...; __Secure-3PAPISID=...; ..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] text-sm text-[var(--md-on-surface)] focus:outline-none focus:border-[var(--md-primary)] resize-none"
                  />
                </div>

                <div className="space-y-3 mb-4">
                  <label className="block text-xs font-semibold text-[var(--md-on-surface-variant)] mb-1">
                    Visitor Data (optional)
                  </label>
                  <input
                    type="text"
                    value={visitorDataInput}
                    onChange={(e) => setVisitorDataInput(e.target.value)}
                    placeholder="Cgt... (from music.youtube.com localStorage → visitor_data)"
                    className="w-full px-3 py-2 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] text-sm text-[var(--md-on-surface)] focus:outline-none focus:border-[var(--md-primary)]"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCookieInput(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-container-high)] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCookieInputSubmit}
                    disabled={cookieInputLoading || !cookieInput.trim()}
                    className="flex-1 px-4 py-2.5 rounded-xl font-semibold bg-[var(--md-primary)] text-[var(--md-on-primary)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    {cookieInputLoading ? 'Saving...' : 'Save & Sync'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
