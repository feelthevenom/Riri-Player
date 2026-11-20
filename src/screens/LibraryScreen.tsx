import React, { useMemo, useRef, useState } from 'react';
import {
  Disc3,
  FolderUp,
  ListMusic,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Upload,
  User,
  UserCircle2,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { LibraryFilter } from '../types/music';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';
import { SortableTrackTable } from '../components/SortableTrackTable';

const FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: 'LIBRARY', label: 'All' },
  { id: 'PLAYLISTS', label: 'Playlists' },
  { id: 'SONGS', label: 'Songs' },
  { id: 'YTMUSIC', label: 'YT Music' },
  { id: 'ARTISTS', label: 'Artists' },
  { id: 'ALBUMS', label: 'Albums' },
  { id: 'LOCAL', label: 'Local Audio' },
];

export const LibraryScreen: React.FC = () => {
  const {
    libraryFilter,
    setLibraryFilter,
    playlists,
    tracks,
    tags,
    selectedTagId,
    setSelectedTagId,
    createPlaylist,
    importLocalFiles,
    setShowSpotifyModal,
    activeYtAccount,
    signOutGoogleAccount,
    triggerGoogleSignIn,
    signingInGoogle,
    ytSavedAlbums,
    ytFollowedArtists,
    ytUploadedTracks,
    openYtMusicBrowse,
    syncYtMusicLibrary,
    navigate,
  } = useRiriPlayer();

  const [ytMusicSignInLoading, setYtMusicSignInLoading] = useState(false);

  const [newName, setNewName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const localTracks = useMemo(
    () => tracks.filter((t) => t.source === 'local'),
    [tracks],
  );

  const ytMusicTracks = useMemo(
    () => tracks.filter((t) => t.source === 'ytmusic'),
    [tracks],
  );

  const ytCloudPlaylists = useMemo(
    () => playlists.filter((p) => Boolean(p.ytBrowseId)),
    [playlists],
  );

  const visiblePlaylists = useMemo(() => {
    if (!selectedTagId) return playlists;
    return playlists.filter((p) => p.tagIds.includes(selectedTagId));
  }, [playlists, selectedTagId]);

  const artists = useMemo(() => {
    const map = new Map<string, { name: string; count: number; art: string }>();
    for (const t of tracks) {
      const existing = map.get(t.artist);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(t.artist, {
          name: t.artist,
          count: 1,
          art: t.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL,
        });
      }
    }
    return Array.from(map.values());
  }, [tracks]);

  const albums = useMemo(() => {
    const map = new Map<string, { name: string; artist: string; count: number; art: string }>();
    for (const t of tracks) {
      const existing = map.get(t.album);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(t.album, {
          name: t.album,
          artist: t.artist,
          count: 1,
          art: t.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL,
        });
      }
    }
    return Array.from(map.values());
  }, [tracks]);

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const pl = createPlaylist(newName);
    setNewName('');
    setShowCreateForm(false);
    navigate('playlist', pl.id);
  };

  const handleSyncYt = async () => {
    setSyncing(true);
    await syncYtMusicLibrary();
    setSyncing(false);
  };

  return (
    <div
      className="space-y-6 pb-8"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          void importLocalFiles(e.dataTransfer.files);
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Your Library</h1>
          <p className="text-xs text-[var(--md-on-surface-variant)]">
            {playlists.length} playlists · {tracks.length} saved tracks · {ytMusicTracks.length} YT Music ·{' '}
            {localTracks.length} local files
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.opus"
            onChange={(e) => {
              if (e.target.files) void importLocalFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] whitespace-nowrap cursor-pointer"
          >
            <FolderUp className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Add Local Audio</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSpotifyModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] whitespace-nowrap cursor-pointer"
          >
            <Disc3 className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Import Playlist</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-primary)] text-[var(--md-on-primary)] whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Playlist</span>
          </button>
        </div>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreatePlaylist}
          className="at-glass-card flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-4"
        >
          <input
            type="text"
            autoFocus
            aria-label="New playlist title"
            placeholder="Enter playlist name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 min-w-[200px] h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] px-3.5 text-sm focus:outline-none focus:border-[var(--md-primary)]"
          />
          <button
            type="submit"
            className="px-4 h-10 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold cursor-pointer"
          >
            Create Playlist
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm(false)}
            className="px-3 h-10 rounded-xl text-xs font-semibold text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setLibraryFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              libraryFilter === f.id
                ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* YouTube Music Account Sync Bar + Cloud Collections */}
      {libraryFilter === 'YTMUSIC' && (
        <div className="space-y-6">
          <div className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {activeYtAccount?.avatarUrl ? (
                <img
                  src={activeYtAccount.avatarUrl}
                  alt={activeYtAccount.name}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-[var(--md-primary)]/40"
                />
              ) : (
                <UserCircle2 className="w-9 h-9 text-[var(--md-primary)] shrink-0" />
              )}
              <div>
                <div className="text-sm font-bold">
                  {activeYtAccount
                    ? `Signed in as ${activeYtAccount.name}`
                    : 'YouTube Music Library'}
                </div>
                <div className="text-xs text-[var(--md-on-surface-variant)]">
                  {activeYtAccount
                    ? `Synced: ${ytCloudPlaylists.length} playlists · ${ytSavedAlbums.length} albums · ${ytFollowedArtists.length} artists · ${ytUploadedTracks.length} cloud uploads`
                    : 'Sign in to YouTube Music to import and sync your Liked Music, playlists, albums & cloud uploads.'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {activeYtAccount ? (
                <>
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void handleSyncYt()}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                    <span>Sync Library</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void signOutGoogleAccount()}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 whitespace-nowrap cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign out</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={ytMusicSignInLoading || signingInGoogle}
                  onClick={async () => {
                    setYtMusicSignInLoading(true);
                    try {
                      await triggerGoogleSignIn();
                    } finally {
                      setYtMusicSignInLoading(false);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-primary)] text-[var(--md-on-primary)] whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {ytMusicSignInLoading || signingInGoogle ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogIn className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {ytMusicSignInLoading || signingInGoogle
                      ? 'Opening YouTube Music...'
                      : 'Sign in to YouTube Music'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {ytCloudPlaylists.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-bold">Cloud Synced Playlists</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {ytCloudPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => navigate('playlist', pl.id)}
                    className="at-glass-card text-left rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] p-4 transition-colors cursor-pointer"
                  >
                    <div className="aspect-video rounded-xl overflow-hidden mb-3 bg-[var(--md-surface-container-low)] flex items-center justify-center">
                      {pl.coverUrl ? (
                        <img
                          src={pl.coverUrl}
                          alt={pl.name}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                          }}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ListMusic className="w-8 h-8 text-[var(--md-primary)] opacity-60" />
                      )}
                    </div>
                    <div className="font-bold text-sm truncate">{pl.name}</div>
                    <div className="text-xs text-[var(--md-on-surface-variant)] mt-0.5">
                      {pl.trackIds.length} track(s)
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {ytSavedAlbums.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-bold">YouTube Music Saved Albums</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {ytSavedAlbums.map((alb) => (
                  <button
                    key={alb.id}
                    type="button"
                    onClick={() =>
                      alb.browseId && void openYtMusicBrowse(alb.browseId, alb.title, alb.params)
                    }
                    className="at-glass-card text-left rounded-2xl bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 cursor-pointer"
                  >
                    <img
                      src={alb.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                      alt={alb.title}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                      }}
                      className="w-full aspect-square rounded-xl object-cover mb-2.5"
                    />
                    <div className="text-xs font-bold truncate">{alb.title}</div>
                    <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                      {alb.subtitle || 'Album'}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {ytFollowedArtists.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-bold">Followed Artists on YouTube Music</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {ytFollowedArtists.map((artist) => (
                  <button
                    key={artist.id}
                    type="button"
                    onClick={() =>
                      artist.browseId &&
                      void openYtMusicBrowse(artist.browseId, artist.title, artist.params)
                    }
                    className="at-glass-card text-center rounded-2xl bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] p-4 border border-[var(--md-outline-variant)]/30 cursor-pointer"
                  >
                    <img
                      src={artist.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                      alt={artist.title}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                      }}
                      className="w-20 h-20 rounded-full object-cover mx-auto mb-2.5"
                    />
                    <div className="text-xs font-bold truncate">{artist.title}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {ytUploadedTracks.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-bold">Private Cloud Uploads</h2>
              <SortableTrackTable
                tracks={ytUploadedTracks}
                emptyMessage="No private uploads synced."
              />
            </section>
          )}
        </div>
      )}

      {/* Drag & Drop Local Files Dropzone */}
      {(libraryFilter === 'LOCAL' || isDragging) && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-[var(--md-primary)] bg-[var(--md-primary-container)]/30'
              : 'border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] hover:border-[var(--md-primary)]'
          }`}
        >
          <Upload className="w-7 h-7 mx-auto mb-2 text-[var(--md-primary)]" />
          <div className="text-sm font-semibold">Drag &amp; Drop Local Audio Files Here</div>
          <div className="text-xs text-[var(--md-on-surface-variant)] mt-1">
            Supports MP3, FLAC, WAV, OGG, M4A, OPUS — saved persistently in IndexedDB
          </div>
        </div>
      )}

      {/* Playlists Section */}
      {(libraryFilter === 'LIBRARY' || libraryFilter === 'PLAYLISTS') && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold flex items-center gap-2">
              <ListMusic className="w-4 h-4 text-[var(--md-primary)]" />
              <span>Playlists</span>
            </h2>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedTagId(null)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                  !selectedTagId
                    ? 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
                    : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
                }`}
              >
                All Tags
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => setSelectedTagId(selectedTagId === tag.id ? null : tag.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                    selectedTagId === tag.id
                      ? 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
                      : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
                  }`}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {visiblePlaylists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                onClick={() => navigate('playlist', pl.id)}
                className="at-glass-card text-left rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] p-4 transition-colors cursor-pointer"
              >
                <div className="aspect-video rounded-xl overflow-hidden mb-3 bg-[var(--md-surface-container-low)] flex items-center justify-center">
                  {pl.coverUrl ? (
                    <img
                      src={pl.coverUrl}
                      alt={pl.name}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                      }}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ListMusic className="w-8 h-8 text-[var(--md-primary)] opacity-60" />
                  )}
                </div>
                <div className="font-bold text-sm truncate">{pl.name}</div>
                <div className="text-xs text-[var(--md-on-surface-variant)] mt-0.5">
                  {pl.trackIds.length} track(s)
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Artists Section */}
      {libraryFilter === 'ARTISTS' && (
        <section className="space-y-3">
          <h2 className="text-base font-bold">Saved Artists</h2>
          {artists.length === 0 ? (
            <div className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-8 text-center text-xs text-[var(--md-on-surface-variant)]">
              Play or like tracks to populate your saved artists.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {artists.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => navigate('artist', a.name)}
                  className="at-glass-card text-center rounded-2xl bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] p-4 border border-[var(--md-outline-variant)]/30 cursor-pointer"
                >
                  <div className="w-20 h-20 rounded-full overflow-hidden mx-auto mb-2.5 bg-[var(--md-surface-container-low)] flex items-center justify-center">
                    {a.art ? (
                      <img
                        src={a.art}
                        alt={a.name}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-7 h-7" />
                    )}
                  </div>
                  <div className="text-xs font-bold truncate">{a.name}</div>
                  <div className="text-[11px] text-[var(--md-on-surface-variant)]">
                    {a.count} track(s)
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Albums Section */}
      {libraryFilter === 'ALBUMS' && (
        <section className="space-y-3">
          <h2 className="text-base font-bold">Saved Albums</h2>
          {albums.length === 0 ? (
            <div className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-8 text-center text-xs text-[var(--md-on-surface-variant)]">
              Play or like tracks to populate your saved albums.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {albums.map((alb) => (
                <button
                  key={alb.name}
                  type="button"
                  onClick={() => navigate('album', alb.name)}
                  className="at-glass-card text-left rounded-2xl bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 cursor-pointer"
                >
                  <img
                    src={alb.art}
                    alt={alb.name}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                    }}
                    className="w-full aspect-square rounded-xl object-cover mb-2.5"
                  />
                  <div className="text-xs font-bold truncate">{alb.name}</div>
                  <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                    {alb.artist}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Songs / YouTube Music / Local Tracks Table */}
      {(libraryFilter === 'LIBRARY' ||
        libraryFilter === 'SONGS' ||
        libraryFilter === 'YTMUSIC' ||
        libraryFilter === 'LOCAL') && (
        <section className="space-y-3">
          <h2 className="text-base font-bold">
            {libraryFilter === 'LOCAL'
              ? 'Local Audio Files'
              : libraryFilter === 'YTMUSIC'
                ? 'YouTube Music Tracks'
                : 'Saved & Played Tracks'}
          </h2>
          <SortableTrackTable
            tracks={
              libraryFilter === 'LOCAL'
                ? localTracks
                : libraryFilter === 'YTMUSIC'
                  ? ytMusicTracks
                  : tracks
            }
            emptyMessage={
              libraryFilter === 'LOCAL'
                ? 'No local audio files imported yet. Drop MP3, FLAC, WAV, OGG, or M4A files above.'
                : libraryFilter === 'YTMUSIC'
                  ? 'No YouTube Music tracks saved yet. Play a track from Home/Search or import a YT Music playlist.'
                  : 'No tracks saved in your library yet. Play, like, or import music to build your collection.'
            }
          />
        </section>
      )}
    </div>
  );
};
