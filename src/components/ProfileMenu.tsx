import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Settings,
  UserCircle2,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';

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
    navigate,
  } = useRiriPlayer();

  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
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

  const handleYtMusicSignIn = async () => {
    setYtMusicSignInLoading(true);
    setOpen(false);
    try {
      await triggerGoogleSignIn();
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
        {signingInGoogle || ytMusicSignInLoading ? (
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
          {signingInGoogle || ytMusicSignInLoading
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
                onClick={() => void handleYtMusicSignIn()}
                disabled={ytMusicSignInLoading || signingInGoogle}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left font-semibold hover:bg-[var(--md-primary-container)]/35 text-[var(--md-on-surface)] cursor-pointer disabled:opacity-60"
              >
                {ytMusicSignInLoading || signingInGoogle ? (
                  <Loader2 className="w-4 h-4 text-[var(--md-primary)] animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4 text-[var(--md-primary)]" />
                )}
                <span>
                  {ytMusicSignInLoading || signingInGoogle
                    ? 'Opening YouTube Music...'
                    : 'Sign in to YouTube Music'}
                </span>
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
        </div>
      )}
    </div>
  );
};
