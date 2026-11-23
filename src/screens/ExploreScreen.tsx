import React from 'react';
import { Flame, Loader2, Play, RefreshCw } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { MOODS_AND_GENRES } from '../data/catalog';
import { SortableTrackTable } from '../components/SortableTrackTable';

export const ExploreScreen: React.FC = () => {
  const {
    chartsTracks,
    chartsLoading,
    loadCharts,
    playTrack,
    setGlobalSearchQuery,
    navigate,
  } = useRiriPlayer();

  return (
    <div className="space-y-8 pb-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <Flame className="w-6 h-6 text-[var(--md-primary)]" />
            <span>Explore &amp; Top Charts</span>
          </h1>
          <p className="text-xs text-[var(--md-on-surface-variant)]">
            Trending releases, Moods &amp; Genres, and Global Charts across YouTube Music
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadCharts()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${chartsLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {chartsTracks.length > 0 && (
            <button
              type="button"
              onClick={() => void playTrack(chartsTracks[0], chartsTracks)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-primary)] text-[var(--md-on-primary)] whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play Charts</span>
            </button>
          )}
        </div>
      </div>

      {/* Moods & Genres Tiles */}
      <section aria-label="Moods and Genres">
        <h2 className="text-base font-bold mb-3">Moods &amp; Genres</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {MOODS_AND_GENRES.map((tile) => (
            <button
              key={tile.id}
              type="button"
              onClick={() => {
                setGlobalSearchQuery(tile.query);
                navigate('search');
              }}
              style={{
                background: `radial-gradient(circle at top right, ${tile.accentColor}40, ${tile.color} 72%)`,
              }}
              className="text-left rounded-xl p-3.5 border border-white/10 hover:brightness-110 transition-all cursor-pointer"
            >
              <div className="text-sm font-bold text-white">{tile.title}</div>
              <div className="text-[11px] text-white/75 mt-0.5 line-clamp-2">
                {tile.subtitle}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Live Trending Chart Table */}
      <section aria-label="Trending Charts">
        <h2 className="text-base font-bold mb-3">Trending Now</h2>
        {chartsLoading && chartsTracks.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-xs text-[var(--md-on-surface-variant)]">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--md-primary)]" />
            <span>Fetching live global charts...</span>
          </div>
        ) : (
          <SortableTrackTable
            tracks={chartsTracks}
            emptyMessage="Charts are temporarily unavailable."
          />
        )}
      </section>
    </div>
  );
};
