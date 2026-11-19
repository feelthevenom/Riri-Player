import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock,
  Heart,
  ListMusic,
  Mic2,
  Moon,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useArchiveTune } from '../context/ArchiveTuneContext';
import { Track } from '../types/music';
import { findActiveLyricIndex, formatTime, parseLrcLyrics } from '../utils/lyricsParser';
import { audioEngine } from '../utils/audioEngine';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';

type RightPanelTab = 'LYRICS' | 'QUEUE';
type SleepPreset = { label: string; minutes: number | null; endOfTrack?: boolean };

const SLEEP_PRESETS: SleepPreset[] = [
  { label: 'Off', minutes: null },
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '45 minutes', minutes: 45 },
  { label: '60 minutes', minutes: 60 },
  { label: 'End of current track', minutes: null, endOfTrack: true },
];

export const FullscreenCinemaPlayer: React.FC = () => {
  const archiveCtx = useArchiveTune();
  const {
    fullscreenPlayer,
    setFullscreenPlayer,
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    repeatMode,
    cycleRepeatMode,
    shuffleEnabled,
    toggleShuffle,
    isTrackLiked,
    toggleLike,
    setShowEqModal,
    setShowMiniOverlay,
    settings,
    dynamicArtworkSecondary,
    activeTrackLyrics,
    navigate,
    showToast,
  } = archiveCtx;

  // Optional context extensions for queue, volume, and sleep timer
  const extCtx = archiveCtx as unknown as {
    queue?: Track[];
    currentIndex?: number;
    queueIndex?: number;
    playTrack?: (track: Track, queue?: Track[]) => Promise<void> | void;
    playFromQueue?: (index: number) => Promise<void> | void;
    removeFromQueue?: (index: number) => void;
    clearQueue?: () => void;
    volume?: number;
    setVolume?: (val: number) => void;
    isMuted?: boolean;
    muted?: boolean;
    toggleMute?: () => void;
    sleepTimerRemainingSec?: number | null;
    setSleepTimer?: (minutes: number | null) => void;
  };

  const [rightTab, setRightTab] = useState<RightPanelTab>('LYRICS');
  const [sleepMenuOpen, setSleepMenuOpen] = useState(false);
  const [localSleepSec, setLocalSleepSec] = useState<number | null>(null);
  const [sleepEndOfTrack, setSleepEndOfTrack] = useState(false);

  const [localVolume, setLocalVolume] = useState<number>(() => {
    const engineWithVol = audioEngine as unknown as { getVolume?: () => number };
    const v = engineWithVol.getVolume?.();
    return typeof v === 'number' && !Number.isNaN(v) ? v : 0.85;
  });
  const [localMuted, setLocalMuted] = useState(false);
  const prevVolumeRef = useRef<number>(0.85);
  const prevTrackIdRef = useRef<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lyricsBoxRef = useRef<HTMLDivElement | null>(null);
  const sleepPopoverRef = useRef<HTMLDivElement | null>(null);

  // Normalize volume (supports both 0..1 and 0..100 context scales)
  const usesHundredScale = typeof extCtx.volume === 'number' && extCtx.volume > 1;
  const normalizedVolume = useMemo(() => {
    if (typeof extCtx.volume === 'number') {
      return usesHundredScale ? Math.min(1, Math.max(0, extCtx.volume / 100)) : extCtx.volume;
    }
    return localVolume;
  }, [extCtx.volume, usesHundredScale, localVolume]);

  const effectiveMuted =
    typeof extCtx.isMuted === 'boolean'
      ? extCtx.isMuted
      : typeof extCtx.muted === 'boolean'
        ? extCtx.muted
        : localMuted || normalizedVolume === 0;

  const displayVolume = effectiveMuted ? 0 : normalizedVolume;

  const handleVolumeChange = (nextNorm: number) => {
    const clamped = Math.min(1, Math.max(0, nextNorm));
    if (clamped > 0) {
      prevVolumeRef.current = clamped;
      setLocalMuted(false);
    }
    setLocalVolume(clamped);

    if (extCtx.setVolume) {
      extCtx.setVolume(usesHundredScale ? Math.round(clamped * 100) : clamped);
    } else {
      const engineWithVol = audioEngine as unknown as { setVolume?: (v: number) => void };
      engineWithVol.setVolume?.(clamped);
    }
  };

  const handleToggleMute = () => {
    if (extCtx.toggleMute) {
      extCtx.toggleMute();
      return;
    }
    if (effectiveMuted) {
      const restore = prevVolumeRef.current > 0.05 ? prevVolumeRef.current : 0.75;
      setLocalMuted(false);
      handleVolumeChange(restore);
    } else {
      if (normalizedVolume > 0) prevVolumeRef.current = normalizedVolume;
      setLocalMuted(true);
      handleVolumeChange(0);
    }
  };

  // Sleep Timer state & countdown
  const activeSleepSec =
    typeof extCtx.sleepTimerRemainingSec === 'number'
      ? extCtx.sleepTimerRemainingSec
      : localSleepSec;

  useEffect(() => {
    if (typeof extCtx.sleepTimerRemainingSec === 'number') return;
    if (localSleepSec === null) return;

    const timer = window.setInterval(() => {
      setLocalSleepSec((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (isPlaying) {
            void togglePlayPause();
          }
          showToast?.('Sleep timer ended · Playback paused');
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [localSleepSec, extCtx.sleepTimerRemainingSec, isPlaying, togglePlayPause, showToast]);

  // "End of current track" sleep mode
  useEffect(() => {
    const currentId = currentTrack?.id ?? null;
    if (
      sleepEndOfTrack &&
      prevTrackIdRef.current &&
      currentId &&
      prevTrackIdRef.current !== currentId
    ) {
      setSleepEndOfTrack(false);
      if (isPlaying) {
        void togglePlayPause();
      }
      showToast?.('Sleep timer · Paused at end of track');
    }
    prevTrackIdRef.current = currentId;
  }, [currentTrack?.id, sleepEndOfTrack, isPlaying, togglePlayPause, showToast]);

  const handleSelectSleepPreset = (preset: SleepPreset) => {
    setSleepMenuOpen(false);
    if (preset.endOfTrack) {
      setLocalSleepSec(null);
      extCtx.setSleepTimer?.(null);
      setSleepEndOfTrack(true);
      showToast?.('Sleep timer set for end of current track');
      return;
    }

    setSleepEndOfTrack(false);
    if (preset.minutes === null) {
      setLocalSleepSec(null);
      extCtx.setSleepTimer?.(null);
      showToast?.('Sleep timer turned off');
    } else {
      if (extCtx.setSleepTimer) {
        extCtx.setSleepTimer(preset.minutes);
      } else {
        setLocalSleepSec(preset.minutes * 60);
      }
      showToast?.(`Sleep timer set for ${preset.minutes} min`);
    }
  };

  // Close sleep popover on outside click & handle Escape key
  useEffect(() => {
    if (!fullscreenPlayer) return;

    const onMouseDown = (e: MouseEvent) => {
      if (
        sleepMenuOpen &&
        sleepPopoverRef.current &&
        !sleepPopoverRef.current.contains(e.target as Node)
      ) {
        setSleepMenuOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sleepMenuOpen) {
          setSleepMenuOpen(false);
        } else {
          setFullscreenPlayer(false);
        }
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreenPlayer, sleepMenuOpen, setFullscreenPlayer]);

  // Queue resolution
  const queueTracks = useMemo<Track[]>(() => {
    if (Array.isArray(extCtx.queue) && extCtx.queue.length > 0) {
      return extCtx.queue;
    }
    return currentTrack ? [currentTrack] : [];
  }, [extCtx.queue, currentTrack]);

  const activeQueueIndex = useMemo(() => {
    if (typeof extCtx.currentIndex === 'number' && extCtx.currentIndex >= 0) {
      return extCtx.currentIndex;
    }
    if (typeof extCtx.queueIndex === 'number' && extCtx.queueIndex >= 0) {
      return extCtx.queueIndex;
    }
    if (!currentTrack) return -1;
    return queueTracks.findIndex((t) => t.id === currentTrack.id);
  }, [extCtx.currentIndex, extCtx.queueIndex, queueTracks, currentTrack]);

  const handlePlayQueueItem = (track: Track, index: number) => {
    if (extCtx.playFromQueue) {
      void extCtx.playFromQueue(index);
    } else if (extCtx.playTrack) {
      void extCtx.playTrack(track, queueTracks);
    }
  };

  const handleOpenMiniPlayer = () => {
    setShowMiniOverlay?.(true);
    setFullscreenPlayer(false);
  };

  // Lyrics parsing & auto-scroll
  const parsedLyrics = useMemo(
    () => parseLrcLyrics(activeTrackLyrics.syncedLyrics),
    [activeTrackLyrics.syncedLyrics],
  );
  const activeIdx = useMemo(
    () => findActiveLyricIndex(parsedLyrics, positionSec * 1000, settings.lyricsOffsetMs),
    [parsedLyrics, positionSec, settings.lyricsOffsetMs],
  );

  useEffect(() => {
    if (!fullscreenPlayer || rightTab !== 'LYRICS' || activeIdx < 0 || !lyricsBoxRef.current) {
      return;
    }
    const el = lyricsBoxRef.current.querySelector(
      `[data-fs-lyric="${activeIdx}"]`,
    ) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIdx, fullscreenPlayer, rightTab]);

  // Real-time 32-band Web Audio frequency spectrum visualizer
  useEffect(() => {
    if (!fullscreenPlayer) return;
    let rafId = 0;

    const renderFrame = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          const bars = 32;
          const levels = audioEngine.getFrequencyLevels(bars);
          const primaryColor =
            getComputedStyle(document.documentElement)
              .getPropertyValue('--md-primary')
              .trim() || '#ED5564';

          const barWidth = w / bars;
          for (let i = 0; i < bars; i++) {
            const raw = levels[i] || 0;
            const norm = isPlaying ? Math.max(0.06, raw) : 0.04;
            const barH = norm * (h - 6);
            const x = i * barWidth + 2;
            const y = h - barH;
            ctx.fillStyle = primaryColor;
            ctx.globalAlpha = 0.35 + norm * 0.65;
            ctx.beginPath();
            ctx.roundRect(x, y, Math.max(3, barWidth - 4), barH, 3);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, [fullscreenPlayer, isPlaying]);

  if (!fullscreenPlayer || !currentTrack) return null;

  const liked = isTrackLiked(currentTrack.id);
  const progressPct = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
  const secondaryBg = dynamicArtworkSecondary || '#1A1316';

  const isSolidTheme = settings.playerBackgroundStyle === 'SOLID';
  const bgStyle: React.CSSProperties = isSolidTheme
    ? { backgroundColor: 'var(--md-background)' }
    : settings.playerBackgroundStyle === 'GLOW'
      ? {
          background: `radial-gradient(circle at 28% 35%, var(--md-primary-container) 0%, ${secondaryBg} 55%, #090809 100%)`,
        }
      : {
          background: `linear-gradient(135deg, ${secondaryBg} 0%, #141013 60%, #090708 100%)`,
        };

  const fgClass = isSolidTheme ? 'text-[var(--md-on-surface)]' : 'text-white';
  const mutedFgClass = isSolidTheme ? 'text-[var(--md-on-surface-variant)]' : 'text-white/70';
  const pillSurfaceClass = isSolidTheme
    ? 'bg-black/5 hover:bg-black/10 border-black/10'
    : 'bg-white/10 hover:bg-white/15 border-white/10';
  const activeTabClass =
    'bg-[var(--md-primary)] text-[var(--md-on-primary)] shadow-sm';
  const inactiveTabClass = isSolidTheme
    ? 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
    : 'text-white/70 hover:text-white';

  const hasActiveSleep = (activeSleepSec !== null && activeSleepSec > 0) || sleepEndOfTrack;

  const VolumeIcon =
    effectiveMuted || displayVolume === 0
      ? VolumeX
      : displayVolume < 0.5
        ? Volume1
        : Volume2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fullscreen Cinema Player"
      style={bgStyle}
      className={`fixed inset-0 z-40 flex flex-col overflow-hidden ${fgClass}`}
    >
      {settings.playerBackgroundStyle === 'BLUR' && currentTrack.thumbnailUrl && (
        <img
          src={currentTrack.thumbnailUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-20 blur-3xl scale-110 pointer-events-none"
        />
      )}

      {/* Top Header */}
      <header className="relative z-10 flex items-center justify-between px-6 lg:px-10 py-4">
        <button
          type="button"
          onClick={() => setFullscreenPlayer(false)}
          aria-label="Exit fullscreen player"
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border backdrop-blur-md text-xs font-semibold transition-colors cursor-pointer ${pillSurfaceClass}`}
        >
          <ChevronDown className="w-4 h-4" />
          <span>Minimize Player</span>
        </button>

        <div className={`text-xs font-semibold tracking-wide ${mutedFgClass}`}>
          Now Playing · {currentTrack.qualityLabel || currentTrack.source.toUpperCase()}
        </div>

        <button
          type="button"
          onClick={() => setShowEqModal(true)}
          aria-label="Open 10-band Equalizer"
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border backdrop-blur-md text-xs font-semibold transition-colors cursor-pointer ${pillSurfaceClass}`}
        >
          <Sliders className="w-4 h-4" />
          <span>10-Band EQ</span>
        </button>
      </header>

      {/* Main Split Stage */}
      <main className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 px-6 sm:px-10 lg:px-16 py-2 overflow-hidden items-center">
        {/* Left: Artwork + Spectrum Visualizer + Track Metadata */}
        <div className="flex flex-col items-center justify-center max-w-md mx-auto w-full">
          <div className="w-60 h-60 sm:w-76 sm:h-76 lg:w-80 lg:h-80 rounded-3xl overflow-hidden shadow-2xl border border-white/10 mb-5 bg-black/40">
            <img
              src={currentTrack.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
              alt={currentTrack.title}
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
              }}
              className="w-full h-full object-cover"
            />
          </div>

          <canvas
            ref={canvasRef}
            width={360}
            height={48}
            aria-label="Real-time audio frequency spectrum"
            className="w-full max-w-[340px] h-11 mb-4"
          />

          <div className="w-full flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold truncate">{currentTrack.title}</h2>
              <button
                type="button"
                onClick={() => {
                  setFullscreenPlayer(false);
                  navigate('artist', currentTrack.artist);
                }}
                className={`text-sm ${mutedFgClass} hover:underline truncate block cursor-pointer`}
              >
                {currentTrack.artist} · {currentTrack.album}
              </button>
            </div>
            <button
              type="button"
              onClick={() => toggleLike(currentTrack.id, currentTrack)}
              aria-label={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
              className={`p-2.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer shrink-0 ${
                liked ? 'text-[var(--md-primary)]' : mutedFgClass
              }`}
            >
              <Heart className={`w-6 h-6 ${liked ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>

        {/* Right: Segmented Switcher (Synced Lyrics / Up Next Queue) */}
        <div className="flex flex-col h-full max-h-[58vh] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 pb-3">
            <div
              role="tablist"
              aria-label="Fullscreen secondary panel"
              className={`inline-flex items-center p-1 rounded-xl border backdrop-blur-md ${
                isSolidTheme ? 'bg-black/5 border-black/10' : 'bg-white/10 border-white/10'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'LYRICS'}
                onClick={() => setRightTab('LYRICS')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  rightTab === 'LYRICS' ? activeTabClass : inactiveTabClass
                }`}
              >
                <Mic2 className="w-3.5 h-3.5" />
                <span>Lyrics</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'QUEUE'}
                onClick={() => setRightTab('QUEUE')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  rightTab === 'QUEUE' ? activeTabClass : inactiveTabClass
                }`}
              >
                <ListMusic className="w-3.5 h-3.5" />
                <span>Up Next</span>
                {queueTracks.length > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono-tabular ${
                      rightTab === 'QUEUE'
                        ? 'bg-black/20 text-current'
                        : 'bg-white/15 text-current'
                    }`}
                  >
                    {queueTracks.length}
                  </span>
                )}
              </button>
            </div>

            {rightTab === 'QUEUE' && extCtx.clearQueue && queueTracks.length > 1 && (
              <button
                type="button"
                onClick={() => extCtx.clearQueue?.()}
                className={`text-xs font-medium hover:underline cursor-pointer ${mutedFgClass}`}
              >
                Clear Queue
              </button>
            )}
          </div>

          {rightTab === 'LYRICS' ? (
            <div
              ref={lyricsBoxRef}
              className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-5 font-lyrics"
            >
              {activeTrackLyrics.loading ? (
                <div className={`text-center text-sm ${mutedFgClass} pt-20`}>
                  Loading synced karaoke lyrics...
                </div>
              ) : parsedLyrics.length > 0 ? (
                parsedLyrics.map((line, idx) => {
                  const active = idx === activeIdx;
                  const tr = activeTrackLyrics.translations[idx];
                  return (
                    <button
                      key={`${line.timeMs}-${idx}`}
                      data-fs-lyric={idx}
                      type="button"
                      onClick={() => seekTo(line.timeMs / 1000)}
                      style={{ fontSize: `${22 * settings.lyricsFontScale}px` }}
                      className={`block w-full text-left leading-snug transition-all cursor-pointer ${
                        active
                          ? 'text-[var(--md-primary)] font-bold scale-[1.03] origin-left'
                          : idx < activeIdx
                            ? 'opacity-45 hover:opacity-80'
                            : 'opacity-75 hover:opacity-100'
                      }`}
                    >
                      <div>{line.text}</div>
                      {tr && tr.toLowerCase() !== line.text.toLowerCase() && (
                        <div className="text-sm font-normal opacity-75 mt-1">{tr}</div>
                      )}
                    </button>
                  );
                })
              ) : activeTrackLyrics.plainLyrics ? (
                <pre className="whitespace-pre-wrap font-lyrics text-lg leading-relaxed opacity-85">
                  {activeTrackLyrics.plainLyrics}
                </pre>
              ) : (
                <div className={`text-center text-sm ${mutedFgClass} pt-20`}>
                  No lyrics available for this track.
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 space-y-1.5">
              {queueTracks.length === 0 ? (
                <div className={`text-center text-sm ${mutedFgClass} pt-20`}>
                  Your playback queue is empty.
                </div>
              ) : (
                queueTracks.map((track, idx) => {
                  const isCurrent =
                    idx === activeQueueIndex ||
                    (activeQueueIndex < 0 && track.id === currentTrack.id);

                  return (
                    <div
                      key={`${track.id}-${idx}`}
                      className={`group flex items-center gap-3 p-2.5 rounded-xl border transition-colors ${
                        isCurrent
                          ? isSolidTheme
                            ? 'bg-[var(--md-primary-container)]/50 border-[var(--md-primary)]/40'
                            : 'bg-white/15 border-white/20'
                          : isSolidTheme
                            ? 'border-transparent hover:bg-black/5'
                            : 'border-transparent hover:bg-white/10'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handlePlayQueueItem(track, idx)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <span
                          className={`w-5 text-center text-xs font-mono-tabular shrink-0 ${
                            isCurrent ? 'text-[var(--md-primary)] font-bold' : mutedFgClass
                          }`}
                        >
                          {isCurrent ? '▶' : idx + 1}
                        </span>
                        <img
                          src={track.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
                          alt={track.title}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
                          }}
                          className="w-10 h-10 rounded-lg object-cover shrink-0 bg-black/30"
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-sm font-semibold truncate ${
                              isCurrent ? 'text-[var(--md-primary)]' : ''
                            }`}
                          >
                            {track.title}
                          </div>
                          <div className={`text-xs truncate ${mutedFgClass}`}>
                            {track.artist}
                          </div>
                        </div>
                      </button>

                      {typeof track.durationSec === 'number' && track.durationSec > 0 && (
                        <span className={`text-xs font-mono-tabular shrink-0 ${mutedFgClass}`}>
                          {formatTime(track.durationSec)}
                        </span>
                      )}

                      {!isCurrent && extCtx.removeFromQueue && (
                        <button
                          type="button"
                          onClick={() => extCtx.removeFromQueue?.(idx)}
                          aria-label={`Remove ${track.title} from queue`}
                          title="Remove from queue"
                          className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/15 transition-opacity cursor-pointer ${mutedFgClass}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bottom Transport & Utility Dock */}
      <footer className="relative z-10 px-6 sm:px-10 lg:px-14 pb-7 pt-2 w-full max-w-6xl mx-auto">
        {/* Progress / Seek Bar */}
        <div className={`flex items-center gap-3 text-xs font-mono-tabular ${mutedFgClass} mb-4`}>
          <span className="w-10 text-right">{formatTime(positionSec)}</span>
          <input
            type="range"
            aria-label="Seek position"
            min={0}
            max={Math.max(1, durationSec)}
            step={0.25}
            value={Math.min(positionSec, durationSec || 1)}
            onChange={(e) => seekTo(parseFloat(e.target.value))}
            style={{
              background: `linear-gradient(to right, var(--md-primary) ${progressPct}%, rgba(128,128,128,0.28) ${progressPct}%)`,
            }}
            className="flex-1 h-1.5 rounded-full appearance-none accent-[var(--md-primary)] cursor-pointer"
          />
          <span className="w-10">{formatTime(durationSec)}</span>
        </div>

        {/* 3-Column Balanced Control Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 items-center gap-4">
          {/* Left Zone: Active Status Pills */}
          <div className="hidden md:flex items-center gap-2 min-w-0">
            {queueTracks.length > 0 && activeQueueIndex >= 0 && (
              <button
                type="button"
                onClick={() => setRightTab('QUEUE')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors ${pillSurfaceClass} ${mutedFgClass}`}
              >
                <ListMusic className="w-3.5 h-3.5" />
                <span>
                  Track {activeQueueIndex + 1} of {queueTracks.length}
                </span>
              </button>
            )}

            {hasActiveSleep && (
              <button
                type="button"
                onClick={() => setSleepMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--md-primary)]/20 border border-[var(--md-primary)]/40 text-[var(--md-primary)] text-[11px] font-semibold cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {sleepEndOfTrack
                    ? 'Sleep: End of track'
                    : `Sleep: ${formatTime(activeSleepSec || 0)}`}
                </span>
              </button>
            )}
          </div>

          {/* Center Zone: Core Playback Controls */}
          <div className="flex items-center justify-center gap-5">
            <button
              type="button"
              onClick={toggleShuffle}
              aria-label="Toggle shuffle"
              title="Shuffle"
              className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
                shuffleEnabled ? 'text-[var(--md-primary)]' : mutedFgClass
              }`}
            >
              <Shuffle className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => void prevTrack()}
              aria-label="Previous track"
              title="Previous"
              className="p-2.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
            >
              <SkipBack className="w-6 h-6 fill-current" />
            </button>

            <button
              type="button"
              onClick={() => void togglePlayPause()}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
              className="w-14 h-14 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => void nextTrack()}
              aria-label="Next track"
              title="Next"
              className="p-2.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
            >
              <SkipForward className="w-6 h-6 fill-current" />
            </button>

            <button
              type="button"
              onClick={cycleRepeatMode}
              aria-label={`Repeat mode: ${repeatMode}`}
              title={`Repeat: ${repeatMode}`}
              className={`p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer ${
                repeatMode !== 'OFF' ? 'text-[var(--md-primary)]' : mutedFgClass
              }`}
            >
              {repeatMode === 'ONE' ? (
                <Repeat1 className="w-5 h-5" />
              ) : (
                <Repeat className="w-5 h-5" />
              )}
            </button>
          </div>

          {/* Right Zone: Mini-Player, Sleep Timer, Lyrics, Queue & Volume */}
          <div className="flex items-center justify-center md:justify-end gap-1.5">
            {/* Switch to Mini-Player Overlay */}
            <button
              type="button"
              onClick={handleOpenMiniPlayer}
              aria-label="Switch to Mini-Player Overlay"
              title="Mini-Player Overlay"
              className={`p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer ${mutedFgClass}`}
            >
              <PictureInPicture2 className="w-4.5 h-4.5" />
            </button>

            {/* Sleep Timer Button + Popover */}
            <div ref={sleepPopoverRef} className="relative">
              <button
                type="button"
                onClick={() => setSleepMenuOpen((prev) => !prev)}
                aria-label="Sleep Timer"
                aria-expanded={sleepMenuOpen}
                title="Sleep Timer"
                className={`flex items-center gap-1 p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer ${
                  hasActiveSleep ? 'text-[var(--md-primary)]' : mutedFgClass
                }`}
              >
                <Moon className="w-4.5 h-4.5" />
                {hasActiveSleep && activeSleepSec !== null && !sleepEndOfTrack && (
                  <span className="text-[11px] font-mono-tabular font-semibold">
                    {formatTime(activeSleepSec)}
                  </span>
                )}
              </button>

              {sleepMenuOpen && (
                <div
                  role="menu"
                  aria-label="Sleep Timer options"
                  className={`absolute bottom-12 right-0 w-52 rounded-2xl border p-1.5 shadow-2xl backdrop-blur-xl z-30 ${
                    isSolidTheme
                      ? 'bg-[var(--md-surface-container-high)] border-[var(--md-outline-variant)] text-[var(--md-on-surface)]'
                      : 'bg-zinc-900/95 border-white/15 text-white'
                  }`}
                >
                  <div
                    className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${mutedFgClass}`}
                  >
                    Sleep Timer
                  </div>
                  {SLEEP_PRESETS.map((preset) => {
                    const isSelected = preset.endOfTrack
                      ? sleepEndOfTrack
                      : preset.minutes === null
                        ? !hasActiveSleep
                        : !sleepEndOfTrack &&
                          activeSleepSec !== null &&
                          Math.ceil(activeSleepSec / 60) === preset.minutes;

                    return (
                      <button
                        key={preset.label}
                        type="button"
                        role="menuitem"
                        onClick={() => handleSelectSleepPreset(preset)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[var(--md-primary)]/20 text-[var(--md-primary)] font-semibold'
                            : 'hover:bg-white/10'
                        }`}
                      >
                        <span>{preset.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Lyrics Quick Focus */}
            <button
              type="button"
              onClick={() => setRightTab('LYRICS')}
              aria-label="Show Synced Lyrics"
              title="Lyrics"
              className={`p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer ${
                rightTab === 'LYRICS' ? 'text-[var(--md-primary)]' : mutedFgClass
              }`}
            >
              <Mic2 className="w-4.5 h-4.5" />
            </button>

            {/* Queue Quick Toggle */}
            <button
              type="button"
              onClick={() =>
                setRightTab((prev) => (prev === 'QUEUE' ? 'LYRICS' : 'QUEUE'))
              }
              aria-label="Toggle Playback Queue"
              title="Up Next Queue"
              className={`p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer ${
                rightTab === 'QUEUE' ? 'text-[var(--md-primary)]' : mutedFgClass
              }`}
            >
              <ListMusic className="w-4.5 h-4.5" />
            </button>

            <div
              aria-hidden="true"
              className={`w-px h-5 mx-1 ${isSolidTheme ? 'bg-black/15' : 'bg-white/15'}`}
            />

            {/* Volume Mute + Slider */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={effectiveMuted ? 'Unmute' : 'Mute'}
                title={
                  effectiveMuted
                    ? 'Unmute'
                    : `Volume: ${Math.round(displayVolume * 100)}%`
                }
                className={`p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer ${mutedFgClass}`}
              >
                <VolumeIcon className="w-4.5 h-4.5" />
              </button>

              <input
                type="range"
                aria-label="Volume"
                min={0}
                max={1}
                step={0.01}
                value={displayVolume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                title={`${Math.round(displayVolume * 100)}%`}
                style={{
                  background: `linear-gradient(to right, var(--md-primary) ${
                    displayVolume * 100
                  }%, rgba(128,128,128,0.3) ${displayVolume * 100}%)`,
                }}
                className="w-24 h-1.5 rounded-full appearance-none accent-[var(--md-primary)] cursor-pointer"
              />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};