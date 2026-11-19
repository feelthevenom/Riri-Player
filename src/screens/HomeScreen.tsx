import React, { useMemo, useRef } from 'react';
import { Disc3, FolderUp, Globe, Loader2, Play, Sparkles } from 'lucide-react';
import { useArchiveTune } from '../context/ArchiveTuneContext';
import { FALLBACK_ARTWORK_DATA_URL, HOME_CHIPS } from '../data/catalog';
import { SortableTrackTable } from '../components/SortableTrackTable';
import { YtMusicBrowseItem } from '../types/music';

export const HomeScreen: React.FC = () => {
  const {
    homeChip,
    setHomeChip,
    homeTracks,
    homeSections,
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
    navigate,
  } = useArchiveTune();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const speedDial = useMemo(() => homeTracks.slice(0, 6), [homeTracks]);

  const recentTracks = useMemo(() => {
    const seen = new Set<string>();
    const list = [];
    for (const ev of playEvents) {
      if (seen.has(ev.trackId)) continue;
      seen.add(ev.trackId);
      const found =
        tracks.find((t) => t.id === ev.trackId) ||
        homeTracks.find((t) => t.id === ev.trackId);
      if (found) list.push(found);
      if (list.length >= 6) break;
    }
    return list;
  }, [homeTracks, playEvents, tracks]);

  const handleBrowseItemClick = (item: YtMusicBrowseItem, shelfItems: YtMusicBrowseItem[]) => {
    if (item.track) {
      const shelfTracks = shelfItems
        .map((s) => s.track)
        .filter((t): t is NonNullable<typeof t> => Boolean(t));
      void playTrack(item.track, shelfTracks.length > 0 ? shelfTracks : [item.track]);
      return;
    }
    if (item.browseId) {
      void openYtMusicBrowse(item.browseId, item.title, item.params);
    }
  };

  const useYtMusicChips = settings.ytMusicEnabled && homeChips.length > 0;

  return (
    <div className="space-y-8 pb-8">
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
              <span>Region: {settings.contentRegion} ({settings.contentLanguage})</span>
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
            Browse Charts
          </button>
        </div>

        {homeLoading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-[var(--md-on-surface-variant)]">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--md-primary)]" />
            <span>Loading live tracks &amp; home feed...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {speedDial.map((track) => (
              <div
                key={track.id}
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
                    onClick={() => void playTrack(track, homeTracks)}
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
                  onClick={() => void playTrack(track, homeTracks)}
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

      {/* YouTube Music Home Carousel Shelves */}
      {!homeLoading &&
        homeSections.slice(0, 12).map((section) => (
          <section key={section.id} aria-label={section.title} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">{section.title}</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {section.items.slice(0, 6).map((item) => (
                <button
                  key={`${section.id}-${item.id}`}
                  type="button"
                  onClick={() => handleBrowseItemClick(item, section.items)}
                  className="at-glass-card group text-left rounded-xl bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container-high)] p-3 border border-[var(--md-outline-variant)]/30 transition-colors cursor-pointer"
                >
                  <div className="aspect-square rounded-lg overflow-hidden mb-2 bg-[var(--md-surface-container)] relative">
                    <img
                      src={item.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                      alt={item.title}
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
                  <div className="text-xs font-semibold truncate">{item.title}</div>
                  <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                    {item.subtitle || item.kind}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}

      {/* Recently Played */}
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

      {/* Quick Picks Sortable Table */}
      <section aria-label="Quick Picks">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">Quick Picks</h2>
          {homeTracks.length > 0 && (
            <button
              type="button"
              onClick={() => void playTrack(homeTracks[0], homeTracks)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play All</span>
            </button>
          )}
        </div>
        <SortableTrackTable
          tracks={homeTracks}
          emptyMessage={
            homeLoading
              ? 'Loading live music streams...'
              : 'No tracks returned right now. Try searching or importing local audio.'
          }
        />
      </section>
    </div>
  );
};
