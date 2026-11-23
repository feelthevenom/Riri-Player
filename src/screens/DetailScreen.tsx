import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Play, Plus, Shuffle, Trash2 } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { Track, Playlist } from '../types/music';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';
import { SortableTrackTable } from '../components/SortableTrackTable';
import { generatePlaylistCoverCollage } from '../utils/playlistCover';

export const DetailScreen: React.FC = () => {
  const {
    route,
    routeParam,
    playlists,
    tracks,
    homeTracks,
    chartsTracks,
    browsedCollections,
    openYtMusicBrowse,
    searchOnlineTracks,
    playTrack,
    createPlaylist,
    removeTrackFromPlaylist,
    deletePlaylist,
    exportPlaylistM3u,
    navigate,
  } = useRiriPlayer();

  const [fetchedTracks, setFetchedTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [playlistCover, setPlaylistCover] = useState<string | null>(null);

  const ytBrowseId =
    route === 'playlist' && routeParam?.startsWith('ytbrowse:')
      ? routeParam.slice('ytbrowse:'.length)
      : null;

  const browsedCollection = ytBrowseId ? browsedCollections[ytBrowseId] : undefined;

  const playlist = useMemo(
    () =>
      route === 'playlist' && !ytBrowseId
        ? playlists.find((p) => p.id === routeParam)
        : undefined,
    [playlists, route, routeParam, ytBrowseId],
  );

  const knownPool = useMemo(() => {
    const map = new Map<string, Track>();
    for (const t of [...tracks, ...homeTracks, ...chartsTracks]) {
      map.set(t.id, t);
    }
    return map;
  }, [chartsTracks, homeTracks, tracks]);

  useEffect(() => {
    if ((route === 'artist' || route === 'album') && routeParam) {
      let cancelled = false;
      setLoading(true);
      void searchOnlineTracks(routeParam).then((res) => {
        if (!cancelled) {
          setFetchedTracks(res);
          setLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    setFetchedTracks([]);
    return undefined;
  }, [route, routeParam, searchOnlineTracks]);

  const detailTracks = useMemo(() => {
    if (ytBrowseId && browsedCollection) {
      return browsedCollection.tracks;
    }
    if (route === 'playlist' && playlist) {
      return playlist.trackIds
        .map((id) => knownPool.get(id))
        .filter((t): t is Track => Boolean(t));
    }

    const q = (routeParam || '').toLowerCase();
    const localMatches = Array.from(knownPool.values()).filter((t) =>
      route === 'artist' ? t.artist.toLowerCase().includes(q) : t.album.toLowerCase().includes(q),
    );
    const seen = new Set<string>();
    const combined: Track[] = [];
    for (const t of [...localMatches, ...fetchedTracks]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      combined.push(t);
    }
    return combined;
  }, [browsedCollection, fetchedTracks, knownPool, playlist, route, routeParam, ytBrowseId]);

  const title = ytBrowseId
    ? browsedCollection?.title || 'YouTube Music Collection'
    : route === 'playlist'
      ? playlist?.name || 'Playlist'
      : routeParam || (route === 'artist' ? 'Artist' : 'Album');

  const subtitle = ytBrowseId
    ? browsedCollection?.subtitle || `${detailTracks.length} track(s)`
    : route === 'playlist'
      ? playlist?.description || `${detailTracks.length} track(s)`
      : route === 'artist'
        ? `Artist Radio & Tracks · ${detailTracks.length} track(s)`
        : `Album Collection · ${detailTracks.length} track(s)`;

  // Generate playlist cover collage for hero art
  useEffect(() => {
    if (route === 'playlist' && playlist && detailTracks.length > 0) {
      // If playlist already has a cover, use it
      if (playlist.coverUrl && !playlist.coverUrl.startsWith('data:')) {
        setPlaylistCover(playlist.coverUrl);
      } else {
        // Generate collage from first 4 tracks
        generatePlaylistCoverCollage(detailTracks, 512).then((collage) => {
          if (collage) setPlaylistCover(collage);
        });
      }
    } else {
      setPlaylistCover(null);
    }
  }, [route, playlist, detailTracks]);

  const heroArt =
    playlistCover ||
    playlist?.coverUrl ||
    detailTracks[0]?.thumbnailUrl ||
    browsedCollection?.cards?.[0]?.thumbnailUrl ||
    FALLBACK_ARTWORK_DATA_URL;

  const isCollectionLoading = Boolean(loading || (ytBrowseId && browsedCollection?.loading));

  const handleShufflePlay = () => {
    if (detailTracks.length === 0) return;
    const rand = detailTracks[Math.floor(Math.random() * detailTracks.length)];
    void playTrack(rand, detailTracks);
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Hero Header */}
      <div className="at-glass-card rounded-3xl border border-[var(--md-outline-variant)]/40 bg-gradient-to-br from-[var(--md-primary-container)]/50 via-[var(--md-surface-container)] to-[var(--md-surface-container-low)] p-6 flex flex-col sm:flex-row items-start sm:items-end gap-6">
        <img
          src={heroArt}
          alt={title}
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
          }}
          className="w-36 h-36 rounded-2xl object-cover shadow-xl shrink-0 bg-[var(--md-surface-container)]"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[var(--md-primary)]">
            {ytBrowseId ? 'YOUTUBE MUSIC' : route.toUpperCase()}
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight truncate">{title}</h1>
          <p className="text-xs text-[var(--md-on-surface-variant)]">{subtitle}</p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              disabled={detailTracks.length === 0}
              onClick={() => detailTracks[0] && void playTrack(detailTracks[0], detailTracks)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold disabled:opacity-40 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Play All</span>
            </button>
            <button
              type="button"
              disabled={detailTracks.length === 0}
              onClick={handleShufflePlay}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] text-xs font-semibold disabled:opacity-40 whitespace-nowrap cursor-pointer"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle</span>
            </button>
            {ytBrowseId && detailTracks.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const pl = createPlaylist(title, 'Saved from YouTube Music', detailTracks);
                  navigate('playlist', pl.id);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[var(--md-primary)]" />
                <span>Save to Library</span>
              </button>
            )}
            {route === 'playlist' && playlist && (
              <button
                type="button"
                disabled={detailTracks.length === 0}
                onClick={() => exportPlaylistM3u(playlist.id)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] text-xs font-semibold disabled:opacity-40 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-4 h-4 text-[var(--md-primary)]" />
                <span>Export .m3u</span>
              </button>
            )}
            {route === 'playlist' && playlist && !playlist.isSystem && (
              <button
                type="button"
                onClick={() => deletePlaylist(playlist.id)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-red-500/15 text-red-500 dark:text-red-300 hover:bg-red-500/25 text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Playlist</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {isCollectionLoading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-[var(--md-on-surface-variant)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--md-primary)]" />
          <span>Loading tracks for {title}...</span>
        </div>
      ) : (
        <SortableTrackTable
          tracks={detailTracks}
          onRemoveTrack={
            route === 'playlist' && playlist
              ? (t) => removeTrackFromPlaylist(playlist.id, t.id)
              : undefined
          }
          emptyMessage="No tracks in this view yet."
          sortContext={route === 'playlist' && playlist?.id === 'pl-liked' ? 'liked' : 'playlist'}
        />
      )}

      {ytBrowseId && browsedCollection && browsedCollection.cards.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-bold">Related Releases &amp; Playlists</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {browsedCollection.cards.slice(0, 10).map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() =>
                  card.browseId && void openYtMusicBrowse(card.browseId, card.title, card.params)
                }
                className="at-glass-card text-left rounded-2xl bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 cursor-pointer"
              >
                <img
                  src={card.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                  alt={card.title}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                  }}
                  className="w-full aspect-square rounded-xl object-cover mb-2.5"
                />
                <div className="text-xs font-bold truncate">{card.title}</div>
                <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                  {card.subtitle}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
