import React, { useEffect, useMemo, useRef } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ListMusic,
  Mic2,
  Minus,
  Plus,
  Radio,
  Trash2,
  X,
} from 'lucide-react';
import { useArchiveTune } from '../context/ArchiveTuneContext';
import { findActiveLyricIndex, formatTime, parseLrcLyrics } from '../utils/lyricsParser';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';
import { YtMusicQueueChip, YtMusicNextResult } from '../types/music';

export const RightContextPanel: React.FC = () => {
  const {
    rightPanel,
    setRightPanel,
    currentTrack,
    positionSec,
    seekTo,
    settings,
    updateSettings,
    activeTrackLyrics,
    queue,
    queueIndex,
    playTrack,
    moveQueueItem,
    removeQueueItem,
    clearQueue,
    queueNextResult,
    queueNextLoading,
    loadMoreQueueNext,
    toggleQueueChip,
  } = useArchiveTune();

  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);

  const parsedLyrics = useMemo(
    () => parseLrcLyrics(activeTrackLyrics.syncedLyrics),
    [activeTrackLyrics.syncedLyrics],
  );

  const activeLineIdx = useMemo(
    () => findActiveLyricIndex(parsedLyrics, positionSec * 1000, settings.lyricsOffsetMs),
    [parsedLyrics, positionSec, settings.lyricsOffsetMs],
  );

  useEffect(() => {
    if (rightPanel !== 'lyrics' || activeLineIdx < 0 || !lyricsContainerRef.current) return;
    const activeEl = lyricsContainerRef.current.querySelector(
      `[data-lyric-idx="${activeLineIdx}"]`,
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLineIdx, rightPanel]);

  if (rightPanel === 'closed') return null;

  return (
    <aside
      aria-label={rightPanel === 'lyrics' ? 'Synced Lyrics Panel' : 'Up Next Queue Panel'}
      className="at-glass-panel w-80 xl:w-[340px] shrink-0 border-l border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] flex flex-col h-full overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--md-outline-variant)]/40">
        <div className="flex items-center gap-1 bg-[var(--md-surface-container)] p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setRightPanel('lyrics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              rightPanel === 'lyrics'
                ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5" />
            Lyrics
          </button>
          <button
            type="button"
            onClick={() => setRightPanel('queue')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              rightPanel === 'queue'
                ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
            }`}
          >
            <ListMusic className="w-3.5 h-3.5" />
            Queue ({queue.length})
          </button>
        </div>
        <button
          type="button"
          onClick={() => setRightPanel('closed')}
          aria-label="Close side panel"
          className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {rightPanel === 'lyrics' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {currentTrack && (
            <div className="px-4 py-2.5 border-b border-[var(--md-outline-variant)]/30 flex items-center justify-between text-xs">
              <div className="truncate pr-2">
                <div className="font-semibold truncate">{currentTrack.title}</div>
                <div className="text-[var(--md-on-surface-variant)] truncate">
                  {currentTrack.artist}
                  {activeTrackLyrics.source ? ` · ${activeTrackLyrics.source}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({ lyricsOffsetMs: settings.lyricsOffsetMs - 250 })
                  }
                  aria-label="Delay lyrics by 250ms"
                  className="p-1 rounded bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-[10px] font-mono-tabular w-12 text-center text-[var(--md-on-surface-variant)]">
                  {settings.lyricsOffsetMs >= 0 ? '+' : ''}
                  {(settings.lyricsOffsetMs / 1000).toFixed(2)}s
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({ lyricsOffsetMs: settings.lyricsOffsetMs + 250 })
                  }
                  aria-label="Advance lyrics by 250ms"
                  className="p-1 rounded bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          <div
            ref={lyricsContainerRef}
            className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 space-y-4 font-lyrics"
          >
            {!currentTrack ? (
              <div className="text-center text-sm text-[var(--md-on-surface-variant)] pt-12">
                Play any track to view real-time synced karaoke lyrics from LRCLIB &amp; KuGou.
              </div>
            ) : activeTrackLyrics.loading ? (
              <div className="text-center text-sm text-[var(--md-on-surface-variant)] pt-12">
                Fetching synced lyrics...
              </div>
            ) : parsedLyrics.length > 0 ? (
              parsedLyrics.map((line, i) => {
                const isActive = i === activeLineIdx;
                const tr = activeTrackLyrics.translations[i];
                return (
                  <button
                    key={`${line.timeMs}-${i}`}
                    data-lyric-idx={i}
                    type="button"
                    onClick={() => seekTo(line.timeMs / 1000)}
                    style={{ fontSize: `${15 * settings.lyricsFontScale}px` }}
                    className={`block w-full text-left leading-snug transition-all duration-200 cursor-pointer ${
                      isActive
                        ? 'text-[var(--md-primary)] font-bold scale-[1.02] origin-left'
                        : i < activeLineIdx
                          ? 'text-[var(--md-on-surface-variant)]/55 hover:text-[var(--md-on-surface)]'
                          : 'text-[var(--md-on-surface)]/80 hover:text-[var(--md-on-surface)]'
                    }`}
                  >
                    <div>{line.text}</div>
                    {tr && tr.toLowerCase() !== line.text.toLowerCase() && (
                      <div className="text-xs font-normal opacity-75 mt-0.5">{tr}</div>
                    )}
                  </button>
                );
              })
            ) : activeTrackLyrics.plainLyrics ? (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold text-[var(--md-on-surface-variant)]">
                  Plain Lyrics (Unsynced)
                </div>
                <pre className="whitespace-pre-wrap font-lyrics text-sm leading-relaxed text-[var(--md-on-surface)]/90">
                  {activeTrackLyrics.plainLyrics}
                </pre>
              </div>
            ) : (
              <div className="text-center text-sm text-[var(--md-on-surface-variant)] pt-12">
                No synced or plain lyrics found for &ldquo;{currentTrack.title}&rdquo;.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--md-outline-variant)]/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
              Up Next
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
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {queue.length === 0 ? (
              <div className="text-center text-sm text-[var(--md-on-surface-variant)] pt-12">
                Queue is empty. Double-click any track to start listening.
              </div>
            ) : (
              queue.map((t, idx) => {
                const isCurr = idx === queueIndex;
                return (
                  <div
                    key={`${t.id}-q-${idx}`}
                    className={`group flex items-center gap-2.5 p-2 rounded-xl transition-colors ${
                      isCurr
                        ? 'bg-[var(--md-primary-container)]/40 border border-[var(--md-primary)]/40'
                        : 'hover:bg-[var(--md-surface-container-high)]/60'
                    }`}
                  >
                    <img
                      src={t.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                      alt={t.title}
                      onError={(e) => {
                        e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                      }}
                      className="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => void playTrack(t, queue)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div
                        className={`text-xs font-semibold truncate ${
                          isCurr ? 'text-[var(--md-primary)]' : 'text-[var(--md-on-surface)]'
                        }`}
                      >
                        {t.title}
                      </div>
                      <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                        {t.artist} · {formatTime(t.durationSec)}
                      </div>
                    </button>
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
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}
{/* Queue Suggestions / "Up Next" Chips */}
        {(queueNextResult?.queueChips?.length ?? 0) > 0 && (
          <div className="border-t border-[var(--md-outline-variant)]/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[var(--md-on-surface-variant)] uppercase tracking-wider">
                Up Next
              </h3>
              {queueNextLoading && (
                <span className="text-[10px] text-[var(--md-primary)] animate-pulse">
                  Loading...
                </span>
              )}
            </div>
            
            <div className="flex flex-wrap gap-1.5">
              {queueNextResult?.queueChips?.map((chip: YtMusicQueueChip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => toggleQueueChip(chip.id)}
                  className={chip.selected
                  ? 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-[var(--md-primary)] text-[var(--md-on-primary)] shadow-[0_0_0_1px_var(--md-primary)]'
                  : 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-container-high)] hover:text-[var(--md-on-surface)]'}
                >
                  <Radio className={chip.selected ? 'w-3.5 h-3.5 text-[var(--md-on-primary)]' : 'w-3.5 h-3.5 text-[var(--md-on-surface-variant)]'} />
                  <span className="truncate max-w-[140px]">{chip.title}</span>
                </button>
              ))}
            </div>

            {queueNextResult?.continuation && !queueNextLoading && (
              <button
                type="button"
                onClick={loadMoreQueueNext}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-container-high)] hover:text-[var(--md-on-surface)] transition-colors cursor-pointer"
              >
                Load more suggestions
              </button>
            )}
          </div>
        )}
    </aside>
  );
};
