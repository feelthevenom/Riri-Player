import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Heart,
  MoreHorizontal,
  Pause,
  Play,
} from 'lucide-react';
import { Track } from '../types/music';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { formatTime } from '../utils/lyricsParser';
import { SortColumn, SortDirection, sortTracks } from '../utils/trackSorting';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';

interface SortableTrackTableProps {
  tracks: Track[];
  emptyMessage?: string;
  queueContext?: Track[];
  compact?: boolean;
  onRemoveTrack?: (track: Track) => void;
}

export const SortableTrackTable: React.FC<SortableTrackTableProps> = ({
  tracks,
  emptyMessage = 'No tracks to display.',
  queueContext,
  compact = false,
  onRemoveTrack,
}) => {
  const {
    currentTrack,
    isPlaying,
    playTrack,
    togglePlayPause,
    isTrackLiked,
    toggleLike,
    navigate,
    setContextMenu,
  } = useRiriPlayer();

  const [sortCol, setSortCol] = useState<SortColumn>('index');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const sortedTracks = useMemo(
    () => sortTracks(tracks, sortCol, sortDir),
    [tracks, sortCol, sortDir],
  );

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const renderSortIcon = (col: SortColumn) => {
    if (sortCol !== col) return null;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 inline ml-1 text-[var(--md-primary)]" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 inline ml-1 text-[var(--md-primary)]" />
    );
  };

  if (tracks.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--md-outline-variant)]/50 bg-[var(--md-surface-container-low)] p-10 text-center text-sm text-[var(--md-on-surface-variant)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="at-glass-card w-full overflow-hidden rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)]/80">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--md-outline-variant)]/40 text-[11px] font-semibold text-[var(--md-on-surface-variant)]">
            <th className="w-12 py-3 pl-4 pr-2 whitespace-nowrap">
              <button
                type="button"
                onClick={() => handleSort('index')}
                className="inline-flex items-center whitespace-nowrap hover:text-[var(--md-on-surface)] transition-colors cursor-pointer"
                aria-label="Sort by track number"
              >
                # {renderSortIcon('index')}
              </button>
            </th>
            <th className="py-3 px-2 w-[38%]">
              <button
                type="button"
                onClick={() => handleSort('title')}
                className="inline-flex items-center whitespace-nowrap hover:text-[var(--md-on-surface)] transition-colors cursor-pointer"
                aria-label="Sort by title"
              >
                Title {renderSortIcon('title')}
              </button>
            </th>
            {!compact && (
              <th className="py-3 px-2 hidden md:table-cell w-[18%]">
                <button
                  type="button"
                  onClick={() => handleSort('artist')}
                  className="inline-flex items-center whitespace-nowrap hover:text-[var(--md-on-surface)] transition-colors cursor-pointer"
                  aria-label="Sort by artist"
                >
                  Artist {renderSortIcon('artist')}
                </button>
              </th>
            )}
            {!compact && (
              <th className="py-3 px-2 hidden xl:table-cell w-[20%]">
                <button
                  type="button"
                  onClick={() => handleSort('album')}
                  className="inline-flex items-center whitespace-nowrap hover:text-[var(--md-on-surface)] transition-colors cursor-pointer"
                  aria-label="Sort by album"
                >
                  Album {renderSortIcon('album')}
                </button>
              </th>
            )}
            <th className="py-3 px-2 hidden sm:table-cell w-24 whitespace-nowrap">Source</th>
            <th className="py-3 px-2 w-16 text-right whitespace-nowrap">
              <button
                type="button"
                onClick={() => handleSort('duration')}
                className="inline-flex items-center whitespace-nowrap hover:text-[var(--md-on-surface)] transition-colors cursor-pointer"
                aria-label="Sort by duration"
              >
                Time {renderSortIcon('duration')}
              </button>
            </th>
            <th className="py-3 pl-2 pr-4 w-24 text-right whitespace-nowrap">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--md-outline-variant)]/20">
          {sortedTracks.map((track, idx) => {
            const isActive = currentTrack?.id === track.id;
            const liked = isTrackLiked(track.id);
            const activeQueue = queueContext || sortedTracks;

            return (
              <tr
                key={`${track.id}-${idx}`}
                onDoubleClick={() => void playTrack(track, activeQueue)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ track, x: e.clientX, y: e.clientY });
                }}
                className={`group transition-colors ${
                  isActive
                    ? 'bg-[var(--md-primary-container)]/35'
                    : 'hover:bg-[var(--md-surface-container-high)]/65'
                }`}
              >
                <td className="py-2.5 pl-4 pr-2 w-12">
                  <button
                    type="button"
                    onClick={() => {
                      if (isActive) {
                        void togglePlayPause();
                      } else {
                        void playTrack(track, activeQueue);
                      }
                    }}
                    aria-label={
                      isActive && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`
                    }
                    className="w-7 h-7 flex items-center justify-center rounded-md text-xs font-mono-tabular text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] cursor-pointer"
                  >
                    {isActive && isPlaying ? (
                      <Pause className="w-4 h-4 text-[var(--md-primary)]" />
                    ) : (
                      <>
                        <span className="group-hover:hidden">{idx + 1}</span>
                        <Play className="w-4 h-4 hidden group-hover:block text-[var(--md-primary)] fill-current" />
                      </>
                    )}
                  </button>
                </td>

                <td className="py-2.5 px-2 overflow-hidden">
                  <div className="flex items-center gap-3 min-w-0 w-full">
                    <img
                      src={track.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                      alt={track.title}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                      }}
                      className="w-10 h-10 rounded-lg object-cover shrink-0 bg-[var(--md-surface-container)]"
                    />
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => void playTrack(track, activeQueue)}
                        title={track.title}
                        className={`block w-full truncate text-left font-medium hover:underline cursor-pointer ${
                          isActive
                            ? 'text-[var(--md-primary)]'
                            : 'text-[var(--md-on-surface)]'
                        }`}
                      >
                        {track.title}
                      </button>
                      <div className="text-xs text-[var(--md-on-surface-variant)] truncate md:hidden">
                        {track.artist}
                      </div>
                    </div>
                  </div>
                </td>

                {!compact && (
                  <td className="py-2.5 px-2 hidden md:table-cell overflow-hidden">
                    <button
                      type="button"
                      onClick={() => navigate('artist', track.artist)}
                      title={track.artist}
                      className="truncate block w-full text-left text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:underline cursor-pointer"
                    >
                      {track.artist}
                    </button>
                  </td>
                )}

                {!compact && (
                  <td className="py-2.5 px-2 hidden xl:table-cell overflow-hidden">
                    <button
                      type="button"
                      onClick={() => navigate('album', track.album)}
                      title={track.album}
                      className="truncate block w-full text-left text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:underline cursor-pointer"
                    >
                      {track.album}
                    </button>
                  </td>
                )}

                <td className="py-2.5 px-2 hidden sm:table-cell whitespace-nowrap text-xs font-mono-tabular text-[var(--md-on-surface-variant)]">
                  {track.qualityLabel || track.source.toUpperCase()}
                </td>

                <td className="py-2.5 px-2 text-right font-mono-tabular text-xs text-[var(--md-on-surface-variant)] whitespace-nowrap">
                  {formatTime(track.durationSec)}
                </td>

                <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                  <div className="inline-flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => toggleLike(track.id, track)}
                      aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        liked
                          ? 'text-[var(--md-primary)]'
                          : 'text-[var(--md-on-surface-variant)] opacity-70 group-hover:opacity-100 hover:text-[var(--md-on-surface)]'
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
                    </button>
                    {onRemoveTrack && (
                      <button
                        type="button"
                        onClick={() => onRemoveTrack(track)}
                        aria-label={`Remove ${track.title}`}
                        className="px-2 py-1 rounded-lg text-[11px] text-[var(--md-on-surface-variant)] hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setContextMenu({
                          track,
                          x: rect.right - 220,
                          y: rect.bottom + 6,
                        });
                      }}
                      aria-label={`More actions for ${track.title}`}
                      className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-highest)] cursor-pointer"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
