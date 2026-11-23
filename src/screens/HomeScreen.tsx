import React, { useMemo, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  FolderUp,
  Globe,
  Heart,
  Loader2,
  Play,
  Radio,
  Sparkles,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { FALLBACK_ARTWORK_DATA_URL, HOME_CHIPS } from '../data/catalog';
import { formatTime } from '../utils/lyricsParser';
import { Track, YtMusicBrowseItem } from '../types/music';

export const HomeScreen: React.FC = () => {
  const {
    homeChip,
    setHomeChip,
    homeTracks,
    homeSections,
    chartsTracks,
    homeChips,
    selectedHomeChipParams,
    setSelectedHomeChipParams,
    homeSourceLabel,
    homeLoading,
    playTrack,
    openYtMusicBrowse,
    playEvents,
    tracks,
    settings,
    importLocalFiles,
    setShowSpotifyModal,
    isTrackLiked,
    toggleLike,
    setContextMenu,
    navigate,
  } = useRiriPlayer();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Speed Dial tracks
  const speedDialTracks = useMemo(() => {
    if (homeTracks.length > 0) return homeTracks.slice(0, 6);
    for (const sec of homeSections) {
      const sectionTracks = sec.items
        .map((i) => i.track)
        .filter((t): t is Track => Boolean(t));
      if (sectionTracks.length > 0) return sectionTracks.slice(0, 6);
    }
    return chartsTracks.slice(0, 6);
  }, [chartsTracks, homeSections, homeTracks]);

  const recentTracks = useMemo(() => {
    const seen = new Set<string>();
    const list: Track[] = [];
    for (const ev of playEvents) {
      if (seen.has(ev.trackId)) continue;
      seen.add(ev.trackId);
      const found =
        tracks.find((t) => t.id === ev.trackId) ||
        homeTracks.find((t) => t.id === ev.trackId) ||
        chartsTracks.find((t) => t.id === ev.trackId);
      if (found) list.push(found);
      if (list.length >= 6) break;
    }
    return list;
  }, [chartsTracks, homeTracks, playEvents, tracks]);

  const handleBrowseItemClick = (item: YtMusicBrowseItem, shelfItems: YtMusicBrowseItem[]) => {
    if (item.track) {
      const shelfTracks = shelfItems
        .map((s) => s.track)
        .filter((t): t is Track => Boolean(t));
      void playTrack(item.track, shelfTracks.length > 0 ? shelfTracks : [item.track]);
      return;
    }
    if (item.videoId) {
      const pseudoTrack: Track = {
        id: `ytm-${item.videoId}`,
        title: item.title,
        artist: item.subtitle || 'YouTube Music',
        album: 'YouTube Music',
        durationSec: 180,
        thumbnailUrl: item.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL,
        streamUrl: `/api/ytmusic/stream?videoId=${item.videoId}&title=${encodeURIComponent(item.title)}&artist=${encodeURIComponent(item.subtitle || '')}`,
        ytMusicVideoId: item.videoId,
        genre: 'YouTube Music',
        qualityLabel: 'YTM AAC',
        source: 'ytmusic',
      };
      void playTrack(pseudoTrack);
      return;
    }
    if (item.browseId) {
      void openYtMusicBrowse(item.browseId, item.title, item.params);
    }
  };

  const useYtMusicChips = settings.ytMusicEnabled && homeChips.length > 0;

  return (
    <div className="space-y-8 pb-12 max-w-7xl mx-auto">
      {/* Header + Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Home</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--md-on-surface-variant)] mt-0.5">
            <span className="font-medium text-[var(--md-primary)]">{homeSourceLabel}</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => navigate('settings')}
              className="inline-flex items-center gap-1 text-[var(--md-on-surface-variant)] hover:text-[var(--md-primary)] hover:underline cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-[var(--md-primary)]" />
              <span>
                Region: {settings.contentRegion} ({settings.contentLanguage})
              </span>
            </button>
          </div>
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
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] whitespace-nowrap cursor-pointer transition-colors"
          >
            <FolderUp className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Import Local Audio</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSpotifyModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] hover:opacity-90 whitespace-nowrap cursor-pointer transition-opacity"
          >
            <Disc3 className="w-4 h-4" />
            <span>Import Playlist</span>
          </button>
        </div>
      </div>

      {/* Mood Filter Tabs (Live YouTube Music chips when available, fallback catalog chips) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Home mood filters">
        {useYtMusicChips ? (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={selectedHomeChipParams === null}
              onClick={() => setSelectedHomeChipParams(null)}
              className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                selectedHomeChipParams === null
                  ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                  : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              All
            </button>
            {homeChips.map((chip) => {
              const active = selectedHomeChipParams === (chip.params || null);
              return (
                <button
                  key={`${chip.title}-${chip.params || ''}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedHomeChipParams(chip.params || null)}
                  className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                      : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
                  }`}
                >
                  {chip.title}
                </button>
              );
            })}
          </>
        ) : (
          HOME_CHIPS.map((chip) => {
            const active = homeChip === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setHomeChip(chip.id)}
                className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                    : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
                }`}
              >
                {chip.title}
              </button>
            );
          })
        )}
      </div>

      {/* Speed Dial Grid */}
      <section aria-label="Speed Dial">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Speed Dial</span>
          </h2>
          <button
            type="button"
            onClick={() => navigate('explore')}
            className="text-xs font-semibold text-[var(--md-primary)] hover:underline cursor-pointer"
          >
            Browse Explore &amp; Charts
          </button>
        </div>

        {homeLoading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-[var(--md-on-surface-variant)]">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--md-primary)]" />
            <span>Loading quick picks &amp; YouTube Music feed...</span>
          </div>
        ) : speedDialTracks.length === 0 ? (
          <div className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-6 text-xs text-[var(--md-on-surface-variant)]">
            No suggestions loaded yet. Use Search or import local audio to start listening.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {speedDialTracks.map((track) => (
              <div
                key={track.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ track, x: e.clientX, y: e.clientY });
                }}
                className="at-glass-card group flex items-center gap-3 rounded-xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] p-2.5 transition-colors"
              >
                <img
                  src={track.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                  alt={track.title}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                  }}
                  className="w-14 h-14 rounded-lg object-cover shrink-0 shadow-sm"
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => void playTrack(track, speedDialTracks)}
                    className="font-semibold text-sm truncate block text-left w-full hover:underline cursor-pointer"
                  >
                    {track.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('artist', track.artist)}
                    className="text-xs text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] truncate block text-left w-full cursor-pointer mt-0.5"
                  >
                    {track.artist}
                  </button>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleLike(track.id, track)}
                    aria-label={isTrackLiked(track.id) ? `Unlike ${track.title}` : `Like ${track.title}`}
                    className={`p-2 rounded-lg cursor-pointer ${
                      isTrackLiked(track.id)
                        ? 'text-[var(--md-primary)]'
                        : 'text-[var(--md-on-surface-variant)] opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${isTrackLiked(track.id) ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void playTrack(track, speedDialTracks)}
                    aria-label={`Play ${track.title}`}
                    className="w-9 h-9 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer shadow-md"
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* YouTube Music Home Carousel Shelves (Quick Picks, Keep Listening, Forgotten Favorites, Trending, etc.) */}
      {!homeLoading &&
        homeSections.map((section) => {
          const isTrackShelf =
            section.items.length > 0 &&
            section.items.every((it) => it.kind === 'song' || Boolean(it.track));

          return (
            <section key={section.id} aria-label={section.title} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <span>{section.title}</span>
                </h2>
              </div>

              {isTrackShelf ? (
                /* Track Shelf: Multi-column grid of songs with quick play */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {section.items.slice(0, 12).map((item, idx) => {
                    const track =
                      item.track ||
                      ({
                        id: item.videoId ? `ytm-${item.videoId}` : item.id,
                        title: item.title,
                        artist: item.subtitle || 'YouTube Music',
                        album: 'YouTube Music',
                        durationSec: 180,
                        thumbnailUrl: item.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL,
                        streamUrl: item.videoId
                          ? `/api/ytmusic/stream?videoId=${item.videoId}&title=${encodeURIComponent(item.title)}&artist=${encodeURIComponent(item.subtitle || '')}`
                          : '',
                        ytMusicVideoId: item.videoId,
                        genre: 'YouTube Music',
                        qualityLabel: 'YTM AAC',
                        source: 'ytmusic',
                      } as Track);

                    const liked = isTrackLiked(track.id);

                    return (
                      <div
                        key={`${section.id}-${item.id}-${idx}`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ track, x: e.clientX, y: e.clientY });
                        }}
                        className="at-glass-card group flex items-center gap-3 rounded-xl border border-[var(--md-outline-variant)]/30 bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container)] p-2 transition-colors"
                      >
                        <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-[var(--md-surface-container)]">
                          <img
                            src={item.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                            }}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => handleBrowseItemClick(item, section.items)}
                            aria-label={`Play ${item.title}`}
                            className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => handleBrowseItemClick(item, section.items)}
                            className="text-xs font-semibold truncate block text-left w-full hover:underline cursor-pointer"
                          >
                            {item.title}
                          </button>
                          <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate mt-0.5">
                            {item.subtitle || 'Song'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleLike(track.id, track)}
                          aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
                          className={`p-1.5 rounded-lg cursor-pointer shrink-0 ${
                            liked
                              ? 'text-[var(--md-primary)]'
                              : 'text-[var(--md-on-surface-variant)] opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Heart className={`w-3.5 h-3.5 ${liked ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Card Carousel Shelf: Albums, Playlists, Artists, Community Mixes */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
                  {section.items.slice(0, 12).map((item) => {
                    const isArtist = item.kind === 'artist';
                    return (
                      <button
                        key={`${section.id}-${item.id}`}
                        type="button"
                        onClick={() => handleBrowseItemClick(item, section.items)}
                        className="at-glass-card group text-left rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-all cursor-pointer flex flex-col"
                      >
                        <div
                          className={`aspect-square w-full overflow-hidden mb-2.5 bg-[var(--md-surface-container)] relative shadow-sm ${
                            isArtist ? 'rounded-full' : 'rounded-lg'
                          }`}
                        >
                          <img
                            src={item.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          </span>
                        </div>
                        <div className="text-xs font-semibold truncate w-full">{item.title}</div>
                        <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate w-full mt-0.5">
                          {item.subtitle || item.kind}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

      {/* Recently Played */}
      {recentTracks.length > 0 && (
        <section aria-label="Recently Played" className="space-y-3">
          <h2 className="text-lg font-bold">Recently Played</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {recentTracks.map((t) => (
              <button
                key={`recent-${t.id}`}
                type="button"
                onClick={() => void playTrack(t, recentTracks)}
                className="at-glass-card group text-left rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-colors cursor-pointer"
              >
                <div className="aspect-square rounded-lg overflow-hidden mb-2 bg-[var(--md-surface-container)] relative">
                  <img
                    src={t.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                    alt={t.title}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                    }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  </span>
                </div>
                <div className="text-xs font-semibold truncate">{t.title}</div>
                <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate mt-0.5">
                  {t.artist}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
