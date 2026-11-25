import React, { useEffect, useMemo, useRef } from 'react';
import { Languages, ListMusic, Mic2, Minus, Plus, X } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { findActiveLyricIndex, parseLrcLyrics } from '../utils/lyricsParser';
import { hasNonLatinScript } from '../utils/transliterate';
import { UpNextQueueView } from './UpNextQueueView';

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
    toggleLyricsLanguage,
    queue,
  } = useRiriPlayer();

  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);

  const parsedLyrics = useMemo(
    () => parseLrcLyrics(activeTrackLyrics.syncedLyrics),
    [activeTrackLyrics.syncedLyrics],
  );

  const hasAlternateLanguage = Boolean(
    activeTrackLyrics.hasAlternateLanguage ||
    (activeTrackLyrics.englishLyrics && activeTrackLyrics.englishLyrics.length > 0) ||
    hasNonLatinScript(activeTrackLyrics.syncedLyrics || activeTrackLyrics.plainLyrics || '')
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
          {hasAlternateLanguage && (
            <button
              type="button"
              onClick={() => void toggleLyricsLanguage()}
              aria-label={
                settings.lyricsLanguage === 'ENGLISH'
                  ? 'Switch to Native lyrics'
                  : 'Switch to English lyrics'
              }
              title={
                settings.lyricsLanguage === 'ENGLISH'
                  ? 'Showing English transliteration. Click for Native.'
                  : 'Showing Native script. Click for English.'
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                settings.lyricsLanguage === 'ENGLISH'
                  ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)] shadow-sm'
                  : 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              <Languages className="w-3.5 h-3.5" />
              <span>{settings.lyricsLanguage === 'ENGLISH' ? 'English' : 'Native'}</span>
            </button>
          )}
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
                const displayText =
                  settings.lyricsLanguage === 'ENGLISH' &&
                  activeTrackLyrics.englishLyrics?.[i]
                    ? activeTrackLyrics.englishLyrics[i]
                    : line.text;
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
                    <div>{displayText}</div>
                    {tr && tr.toLowerCase() !== displayText.toLowerCase() && (
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
                  {settings.lyricsLanguage === 'ENGLISH' &&
                  activeTrackLyrics.englishLyrics &&
                  activeTrackLyrics.englishLyrics.length > 0
                    ? activeTrackLyrics.englishLyrics.join('\n')
                    : activeTrackLyrics.plainLyrics}
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
        <UpNextQueueView variant="panel" />
      )}
    </aside>
  );
};
