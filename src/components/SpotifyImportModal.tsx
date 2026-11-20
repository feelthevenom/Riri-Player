import React, { useState } from 'react';
import { Disc3, Loader2, Youtube, X } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';

export const SpotifyImportModal: React.FC = () => {
  const {
    showSpotifyModal,
    setShowSpotifyModal,
    importSpotifyPlaylist,
    importYtMusicPlaylist,
    navigate,
  } = useRiriPlayer();

  const [tab, setTab] = useState<'ytmusic' | 'spotify'>('ytmusic');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
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
    if (res.ok && res.playlistId) {
      setInput('');
      window.setTimeout(() => {
        setShowSpotifyModal(false);
        navigate('playlist', res.playlistId);
      }, 650);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import Playlist"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="at-glass-card w-full max-w-lg rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {tab === 'ytmusic' ? (
              <Youtube className="w-5 h-5 text-[var(--md-primary)]" />
            ) : (
              <Disc3 className="w-5 h-5 text-[var(--md-primary)]" />
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

        {/* Source Segmented Toggle */}
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
            Spotify / Track List
          </button>
        </div>

        <p className="text-xs text-[var(--md-on-surface-variant)]">
          {tab === 'ytmusic'
            ? 'Paste any YouTube Music or YouTube playlist URL (or PL.../VL... playlist ID). Works without an API key; private playlists require YouTube Music Sign-In.'
            : 'Paste a public Spotify playlist URL or paste tracks one per line as "Artist - Track Title".'}
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

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSpotifyModal(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
            >
              Cancel
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
