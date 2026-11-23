import React from 'react';
import { ArrowDown, ArrowUp, Loader2, Radio, Trash2, X } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';
import { formatTime } from '../utils/lyricsParser';
import { YtMusicQueueChip } from '../types/music';

interface UpNextQueueViewProps {
  variant?: 'panel' | 'cinema';
  isSolidTheme?: boolean;
}

export const UpNextQueueView: React.FC<UpNextQueueViewProps> = ({
  variant = 'panel',
  isSolidTheme = true,
}) => {
  const {
    queue,
    queueIndex,
    currentTrack,
    playTrack,
    moveQueueItem,
    removeQueueItem,
    clearQueue,
    queueNextResult,
    queueNextLoading,
    loadMoreQueueNext,
    toggleQueueChip,
  } = useRiriPlayer();

  const isCinemaDark = variant === 'cinema' && !isSolidTheme;
  const mutedClass = isCinemaDark ? 'text-white/70' : 'text-[var(--md-on-surface-variant)]';

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {variant === 'panel' && (
        <div className="px-4 py-2.5 border-b border-[var(--md-outline-variant)]/30 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
            Up Next · {queue.length} track{queue.length === 1 ? '' : 's'}
          </span>
          {queue.length > 1 && (
            <button
              type="button"
              onClick={clearQueue}
              className="text-xs text-[var(--md-on-surface-variant)] hover:text-red-400 cursor-pointer"
            >
              Clear Up Next
            </button>
          )}
        </div>
      )}

      {/* Limitless YouTube Music Radio Chips */}
      {(queueNextResult?.queueChips?.length ?? 0) > 0 && (
        <div
          className={`px-3 py-2.5 border-b shrink-0 space-y-2 ${
            isCinemaDark ? 'border-white/10' : 'border-[var(--md-outline-variant)]/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[11px] font-semibold uppercase tracking-wider ${mutedClass}`}>
              Queue Mix
            </span>
            {queueNextLoading && (
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--md-primary)] font-semibold">
                <Loader2 className="w-3 h-3 animate-spin" />
                Updating...
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {queueNextResult?.queueChips.map((chip: YtMusicQueueChip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => void toggleQueueChip(chip.id)}
                className={
                  chip.selected
                    ? 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                    : isCinemaDark
                      ? 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
                      : 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-container-high)] hover:text-[var(--md-on-surface)]'
                }
              >
                <Radio className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[130px]">{chip.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable Queue Tracks */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1.5">
        {queue.length === 0 ? (
          <div className={`text-center text-sm pt-12 ${mutedClass}`}>
            Queue is empty. Play any track to generate limitless YouTube Music suggestions.
          </div>
        ) : (
          queue.map((t, idx) => {
            const isCurr =
              idx === queueIndex || (queueIndex < 0 && currentTrack?.id === t.id);

            return (
              <div
                key={`${t.id}-q-${idx}`}
                className={`group flex items-center gap-2.5 p-2 rounded-xl border transition-colors ${
                  isCurr
                    ? isCinemaDark
                      ? 'bg-white/15 border-white/25'
                      : 'bg-[var(--md-primary-container)]/40 border-[var(--md-primary)]/40'
                    : isCinemaDark
                      ? 'border-transparent hover:bg-white/10'
                      : 'border-transparent hover:bg-[var(--md-surface-container-high)]/60'
                }`}
              >
                {variant === 'cinema' && (
                  <span
                    className={`w-5 text-center text-xs font-mono-tabular shrink-0 ${
                      isCurr ? 'text-[var(--md-primary)] font-bold' : mutedClass
                    }`}
                  >
                    {isCurr ? '▶' : idx + 1}
                  </span>
                )}

                <img
                  src={t.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                  alt={t.title}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                  }}
                  className="w-10 h-10 rounded-lg object-cover shrink-0 bg-black/30"
                />

                <button
                  type="button"
                  onClick={() => void playTrack(t, queue)}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <div
                    className={`text-xs font-semibold truncate ${
                      isCurr
                        ? 'text-[var(--md-primary)]'
                        : isCinemaDark
                          ? 'text-white'
                          : 'text-[var(--md-on-surface)]'
                    }`}
                  >
                    {t.title}
                  </div>
                  <div className={`text-[11px] truncate ${mutedClass}`}>
                    {t.artist}
                    {t.durationSec > 0 ? ` · ${formatTime(t.durationSec)}` : ''}
                  </div>
                </button>

                {variant === 'panel' ? (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveQueueItem(idx, idx - 1)}
                      aria-label={`Move ${t.title} up`}
                      className="p-1 rounded hover:bg-[var(--md-surface-container-highest)] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === queue.length - 1}
                      onClick={() => moveQueueItem(idx, idx + 1)}
                      aria-label={`Move ${t.title} down`}
                      className="p-1 rounded hover:bg-[var(--md-surface-container-highest)] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeQueueItem(idx)}
                      aria-label={`Remove ${t.title} from queue`}
                      className="p-1 rounded hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  !isCurr && (
                    <button
                      type="button"
                      onClick={() => removeQueueItem(idx)}
                      aria-label={`Remove ${t.title} from queue`}
                      title="Remove from queue"
                      className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/15 transition-opacity cursor-pointer ${mutedClass}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
              </div>
            );
          })
        )}

        {queue.length > 0 && (
          <div className="pt-2 pb-1">
            <button
              type="button"
              disabled={queueNextLoading}
              onClick={() => void loadMoreQueueNext()}
              className={`w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                isCinemaDark
                  ? 'bg-white/10 hover:bg-white/15 text-white'
                  : 'bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              {queueNextLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--md-primary)]" />
                  <span>Loading more YouTube Music suggestions...</span>
                </>
              ) : (
                <>
                  <Radio className="w-3.5 h-3.5 text-[var(--md-primary)]" />
                  <span>Load more suggestions</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
