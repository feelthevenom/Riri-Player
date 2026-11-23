import React, { useState } from 'react';
import { Disc3, Loader2, LogIn, RefreshCw, Search, X, Youtube } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';

export const SpotifyImportModal: React.FC = () => {
  const {
    showSpotifyModal,
    setShowSpotifyModal,
    importSpotifyPlaylist,
    importYtMusicPlaylist,
    spotifyConnection,
    spotifySyncing,
    spotifySyncProgress,
    connectSpotifyAccount,
    syncSpotifyLibrary,
    spotifyUnmatchedTracks,
    dismissSpotifyUnmatched,
    setGlobalSearchQuery,
    navigate,
  } = useRiriPlayer();

  const [tab, setTab] = useState<'ytmusic' | 'spotify'>('ytmusic');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!showSpotifyModal) return null;

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    setLoading(true);
    setStatusMsg(null);
    const res =
      tab === 'ytmusic'
        ? await importYtMusicPlaylist(input)
        : await importSpotifyPlaylist(input);
    setLoading(false);
    setStatusMsg({ ok: res.ok, text: res.message });
    if (res.ok && res.playlistId && !(res as { unmatchedTracks?: unknown[] }).unmatchedTracks?.length) {
      setInput('');
      window.setTimeout(() => {
        setShowSpotifyModal(false);
        navigate('playlist', res.playlistId);
      }, 650);
    } else if (res.ok && res.playlistId) {
      setInput('');
    }
  };

  const handleSpotifyLogin = async () => {
    setConnecting(true);
    try {
      const res = await connectSpotifyAccount();
      setStatusMsg({ ok: res.ok, text: res.message });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import Playlist"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="at-glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {tab === 'ytmusic' ? (
              <Youtube className="w-5 h-5 text-[var(--md-primary)]" />
            ) : (
              <Disc3 className="w-5 h-5 text-[#1DB954]" />
            )}
            <h2 className="text-lg font-bold">Import Playlist</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowSpotifyModal(false)}
            aria-label="Close playlist importer"
            className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--md-surface-container-low)] border border-[var(--md-outline-variant)]/40">
          <button
            type="button"
            onClick={() => {
              setTab('ytmusic');
              setStatusMsg(null);
            }}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              tab === 'ytmusic'
                ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
            }`}
          >
            YouTube Music Playlist
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('spotify');
              setStatusMsg(null);
            }}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              tab === 'spotify'
                ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
            }`}
          >
            Spotify Sync & Import
          </button>
        </div>

        {tab === 'spotify' && (
          <div className="rounded-xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-3 space-y-3">
            {spotifyConnection?.loggedIn ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">
                      {spotifyConnection.displayName}
                    </div>
                    <div className="text-[11px] text-[var(--md-on-surface-variant)]">
                      Spotify session connected · matched via YouTube Music
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={spotifySyncing}
                    onClick={() =>
                      void syncSpotifyLibrary(false).then((r) =>
                        setStatusMsg({ ok: r.ok, text: r.message }),
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1DB954] text-black text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    {spotifySyncing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Sync Library</span>
                  </button>
                </div>

                {/* Spotify Sync Progress Bar */}
                {spotifySyncProgress?.inProgress && (
                  <div className="space-y-1.5 p-2 rounded-lg bg-[#1DB954]/10 border border-[#1DB954]/30">
                    <div className="flex justify-between text-[11px] text-[#1DB954]">
                      <span>{spotifySyncProgress.message}</span>
                      <span>
                        {spotifySyncProgress.completed}/{spotifySyncProgress.total}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#1DB954]/30 overflow-hidden">
                      <div
                        className="h-full bg-[#1DB954] transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (spotifySyncProgress.completed /
                                Math.max(1, spotifySyncProgress.total)) *
                                100,
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                    {spotifySyncProgress.currentItem && (
                      <div className="text-[10px] text-[var(--md-on-surface-variant)]">
                        {spotifySyncProgress.currentItem}
                      </div>
                    )}
                  </div>
                )}

                {spotifySyncProgress?.phase === 'complete' && (
                  <div className="text-[11px] text-emerald-400 bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/30">
                    {spotifySyncProgress.message}
                  </div>
                )}

                {spotifySyncProgress?.phase === 'error' && (
                  <div className="text-[11px] text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/30">
                    {spotifySyncProgress.message}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-xs text-[var(--md-on-surface-variant)]">
                  Connect Spotify for full library & private playlist sync (zero API keys).
                </div>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => void handleSpotifyLogin()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1DB954] text-black text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {connecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogIn className="w-3.5 h-3.5" />
                  )}
                  <span>Connect Spotify</span>
                </button>
              </>
            )}
          </div>
        )}

        <p className="text-xs text-[var(--md-on-surface-variant)]">
          {tab === 'ytmusic'
            ? 'Paste any YouTube Music or YouTube playlist URL (or PL.../VL... playlist ID).'
            : 'Paste a Spotify playlist URL or paste tracks one per line as "Artist - Track Title" to match on YouTube Music.'}
        </p>

        <form onSubmit={(e) => void handleImport(e)} className="space-y-4">
          <div>
            <label htmlFor="playlist-import-input" className="block text-xs font-semibold mb-1.5">
              {tab === 'ytmusic' ? 'YouTube Music Playlist URL or ID' : 'Spotify URL or Track List'}
            </label>
            <textarea
              id="playlist-import-input"
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                tab === 'ytmusic'
                  ? 'https://music.youtube.com/playlist?list=PL...'
                  : 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M\nOR:\nDaft Punk - Instant Crush\nM83 - Midnight City'
              }
              className="w-full rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[var(--md-primary)]"
            />
          </div>

          {statusMsg && (
            <div
              className={`rounded-xl px-3.5 py-2.5 text-xs ${
                statusMsg.ok
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'bg-red-500/15 text-red-300 border border-red-500/30'
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          {tab === 'spotify' && spotifyUnmatchedTracks.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <div className="text-xs font-bold text-amber-200">
                Unmatched Tracks ({spotifyUnmatchedTracks.length})
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5">
                {spotifyUnmatchedTracks.slice(0, 12).map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-2 text-[11px] bg-black/20 rounded-lg px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{u.name}</div>
                      <div className="text-[var(--md-on-surface-variant)] truncate">{u.artist}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setGlobalSearchQuery(`${u.artist} ${u.name}`);
                          setShowSpotifyModal(false);
                          navigate('search');
                        }}
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        title="Search manually on YouTube Music"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void dismissSpotifyUnmatched(u.id)}
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSpotifyModal(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--md-primary)] text-[var(--md-on-primary)] disabled:opacity-50 cursor-pointer"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{loading ? 'Importing Tracks...' : 'Import Playlist'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};