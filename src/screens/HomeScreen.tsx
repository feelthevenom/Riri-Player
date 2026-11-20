import React, { useMemo, useRef } from 'react';
import { Disc3, FolderUp, Globe, Heart, Loader2, Play, Sparkles } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { FALLBACK_ARTWORK_DATA_URL, HOME_CHIPS } from '../data/catalog';
import { formatTime } from '../utils/lyricsParser';

export const HomeScreen: React.FC = () => {
  const {
    homeChip,
    setHomeChip,
    homeTracks,
    chartsTracks,
    homeChips,
    selectedHomeChipParams,
    setSelectedHomeChipParams,
    homeSourceLabel,
    homeLoading,
    playTrack,
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

  // Minimal curated selection instead of full YT Music carousel shelves
  const effectiveTracks = useMemo(
    () => (homeTracks.length > 0 ? homeTracks : chartsTracks),
    [homeTracks, chartsTracks],
  );
  const speedDial = useMemo(() => effectiveTracks.slice(0, 6), [effectiveTracks]);
  const minimalSuggestions = useMemo(() => effectiveTracks.slice(0, 8), [effectiveTracks]);

  const recentTracks = useMemo(() => {
    const seen = new Set<string>();
    const list = [];
    for (const ev of playEvents) {
      if (seen.has(ev.trackId)) continue;
      seen.add(ev.trackId);
      const found =
        tracks.find((t) => t.id === ev.trackId) ||
        effectiveTracks.find((t) => t.id === ev.trackId);
      if (found) list.push(found);
      if (list.length >= 6) break;
    }
    return list;
  }, [effectiveTracks, playEvents, tracks]);

  const useYtMusicChips = settings.ytMusicEnabled && homeChips.length > 0;

  return (
    <div className="space-y-8 pb-8 max-w-6xl">
      {/* Header + Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Home</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--md-on-surface-variant)]">
            <span>{homeSourceLabel}</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => navigate('settings')}
              className="inline-flex items-center gap-1 text-[var(--md-primary)] hover:underline cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
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
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] whitespace-nowrap cursor-pointer"
          >
            <FolderUp className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Import Local Audio</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSpotifyModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] hover:opacity-90 whitespace-nowrap cursor-pointer"
          >
            <Disc3 className="w-4 h-4" />
            <span>Import Playlist</span>
          </button>
        </div>
      </div>

      {/* Compact Mood Filter Tabs */}
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
            {homeChips.slice(0, 6).map((chip) => {
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

      {/* Speed Dial (6 minimal picks) */}
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
            <span>Loading quick picks...</span>
          </div>
        ) : speedDial.length === 0 ? (
          <div className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-6 text-xs text-[var(--md-on-surface-variant)]">
            No suggestions loaded yet. Use Search or import local audio to start listening.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {speedDial.map((track) => (
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
                  className="w-14 h-14 rounded-lg object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => void playTrack(track, effectiveTracks)}
                    className="font-semibold text-sm truncate block text-left w-full hover:underline cursor-pointer"
                  >
                    {track.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('artist', track.artist)}
                    className="text-xs text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] truncate block text-left w-full cursor-pointer"
                  >
                    {track.artist}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void playTrack(track, effectiveTracks)}
                  aria-label={`Play ${track.title}`}
                  className="w-9 h-9 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recently Played (only when user has history) */}
      {recentTracks.length > 0 && (
        <section aria-label="Recently Played">
          <h2 className="text-base font-bold mb-3">Recently Played</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {recentTracks.map((t) => (
              <button
                key={`recent-${t.id}`}
                type="button"
                onClick={() => void playTrack(t, recentTracks)}
                className="at-glass-card group text-left rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-colors cursor-pointer"
              >
                <div className="aspect-square rounded-lg overflow-hidden mb-2 bg-[var(--md-surface-container)]">
                  <img
                    src={t.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                    alt={t.title}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                    }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                </div>
                <div className="text-xs font-semibold truncate">{t.title}</div>
                <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                  {t.artist}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Minimal Suggested Songs (8 compact tracks) */}
      {!homeLoading && minimalSuggestions.length > 0 && (
        <section aria-label="Suggested Tracks">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold">Suggested Tracks</h2>
            <button
              type="button"
              onClick={() => void playTrack(minimalSuggestions[0], effectiveTracks)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play All</span>
            </button>
          </div>
          <div className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)]/80 divide-y divide-[var(--md-outline-variant)]/20">
            {minimalSuggestions.map((track, idx) => {
              const liked = isTrackLiked(track.id);
              return (
                <div
                  key={`sug-${track.id}-${idx}`}
                  onDoubleClick={() => void playTrack(track, effectiveTracks)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ track, x: e.clientX, y: e.clientY });
                  }}
                  className="group flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--md-surface-container-high)]/60 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => void playTrack(track, effectiveTracks)}
                    aria-label={`Play ${track.title}`}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-xs font-mono-tabular text-[var(--md-on-surface-variant)] cursor-pointer shrink-0"
                  >
                    <span className="group-hover:hidden">{idx + 1}</span>
                    <Play className="w-3.5 h-3.5 hidden group-hover:block text-[var(--md-primary)] fill-current" />
                  </button>
                  <img
                    src={track.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                    alt={track.title}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                    }}
                    className="w-9 h-9 rounded-lg object-cover shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => void playTrack(track, effectiveTracks)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="text-xs font-semibold truncate hover:underline">
                      {track.title}
                    </div>
                    <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                      {track.artist}
                    </div>
                  </button>
                  <span className="text-xs font-mono-tabular text-[var(--md-on-surface-variant)] hidden sm:inline shrink-0">
                    {formatTime(track.durationSec)}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleLike(track.id, track)}
                    aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
                    className={`p-1.5 rounded-lg cursor-pointer shrink-0 ${
                      liked
                        ? 'text-[var(--md-primary)]'
                        : 'text-[var(--md-on-surface-variant)] opacity-60 group-hover:opacity-100'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
