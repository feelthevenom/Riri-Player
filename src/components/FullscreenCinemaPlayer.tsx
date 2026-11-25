import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock,
  Heart,
  Languages,
  ListMusic,
  Mic2,
  Minimize2,
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
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { findActiveLyricIndex, formatTime, parseLrcLyrics } from '../utils/lyricsParser';
import { hasNonLatinScript } from '../utils/transliterate';
import { audioEngine } from '../utils/audioEngine';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';
import { WindowTitleBar } from './WindowTitleBar';
import { UpNextQueueView } from './UpNextQueueView';
import { SeekBarSlider } from './SeekBarSlider';

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
  const {
    fullscreenPlayer,
    setFullscreenPlayer,
    isAppFullscreen,
    toggleAppFullscreen,
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
    openMiniPlayer,
    settings,
    updateSettings,
    dynamicArtworkSecondary,
    activeTrackLyrics,
    toggleLyricsLanguage,
    navigate,
    showToast,
    queue,
    queueIndex,
    clearQueue,
    sleepTimerMinLeft,
    setSleepTimer,
  } = useRiriPlayer();

  const [rightTab, setRightTab] = useState<RightPanelTab>('LYRICS');
  const [sleepMenuOpen, setSleepMenuOpen] = useState(false);
  const [sleepEndOfTrack, setSleepEndOfTrack] = useState(false);

  const prevVolumeRef = useRef<number>(settings.volume > 0 ? settings.volume : 0.85);
  const prevTrackIdRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lyricsBoxRef = useRef<HTMLDivElement | null>(null);
  const sleepPopoverRef = useRef<HTMLDivElement | null>(null);

  const displayVolume = settings.volume;
  const effectiveMuted = displayVolume === 0;

  const handleVolumeChange = (nextVol: number) => {
    const clamped = Math.min(1, Math.max(0, nextVol));
    if (clamped > 0) prevVolumeRef.current = clamped;
    updateSettings({ volume: clamped });
  };

  const handleToggleMute = () => {
    if (effectiveMuted) {
      handleVolumeChange(prevVolumeRef.current > 0.05 ? prevVolumeRef.current : 0.75);
    } else {
      prevVolumeRef.current = displayVolume;
      handleVolumeChange(0);
    }
  };

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
      showToast('Sleep timer · Paused at end of track');
    }
    prevTrackIdRef.current = currentId;
  }, [currentTrack?.id, sleepEndOfTrack, isPlaying, togglePlayPause, showToast]);

  const handleSelectSleepPreset = (preset: SleepPreset) => {
    setSleepMenuOpen(false);
    if (preset.endOfTrack) {
      setSleepTimer(null);
      setSleepEndOfTrack(true);
      showToast('Sleep timer set for end of current track');
      return;
    }
    setSleepEndOfTrack(false);
    setSleepTimer(preset.minutes);
  };

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
        } else if (!isAppFullscreen) {
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
  }, [fullscreenPlayer, isAppFullscreen, sleepMenuOpen, setFullscreenPlayer]);

  // Lyrics parsing & auto-scroll
  const hasAlternateLanguage = Boolean(
    activeTrackLyrics.hasAlternateLanguage ||
    (activeTrackLyrics.englishLyrics && activeTrackLyrics.englishLyrics.length > 0) ||
    hasNonLatinScript(activeTrackLyrics.syncedLyrics || activeTrackLyrics.plainLyrics || '')
  );

  const parsedLyrics = useMemo(
    () => {
      if (!activeTrackLyrics.syncedLyrics) return [];
      const original = parseLrcLyrics(activeTrackLyrics.syncedLyrics);
      if (
        settings.lyricsLanguage === 'ENGLISH' &&
        activeTrackLyrics.englishLyrics &&
        activeTrackLyrics.englishLyrics.length > 0
      ) {
        return original.map((line, idx) => ({
          ...line,
          text: activeTrackLyrics.englishLyrics![idx] || line.text,
        }));
      }
      return original;
    },
    [activeTrackLyrics.syncedLyrics, activeTrackLyrics.englishLyrics, settings.lyricsLanguage],
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
  const mutedFgClass = isSolidTheme ? 'text-[var(--md-on-surface-variant)]' : 'text-white/75';
  const highContrastBtnClass = isSolidTheme
    ? 'bg-[var(--md-surface-container-highest)] hover:bg-[var(--md-surface-container-high)] text-[var(--md-on-surface)] border border-[var(--md-outline-variant)] shadow-sm'
    : 'bg-zinc-900/75 hover:bg-zinc-800/90 text-white border border-white/25 shadow-sm';
  const activeTabClass = 'bg-[var(--md-primary)] text-[var(--md-on-primary)] shadow-sm';
  const inactiveTabClass = isSolidTheme
    ? 'text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
    : 'text-white/75 hover:text-white';

  const hasActiveSleep = (sleepTimerMinLeft !== null && sleepTimerMinLeft > 0) || sleepEndOfTrack;

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
      aria-label="Cinema Music Player"
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

      {/* Draggable Top Bar matching Home screen (hidden ONLY during F11 / Expand fullscreen) */}
      <WindowTitleBar variant="cinema" isSolidTheme={isSolidTheme} />

      {/* In True Fullscreen (F11 / Expand): show sleek overlay controls so user can restore Cinema window */}
      {isAppFullscreen && (
        <header className="relative z-20 flex items-center justify-between px-6 lg:px-10 py-4">
          <button
            type="button"
            onClick={() => setFullscreenPlayer(false)}
            aria-label="Minimize Player"
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl backdrop-blur-md text-xs font-semibold transition-colors cursor-pointer ${highContrastBtnClass}`}
          >
            <ChevronDown className="w-4 h-4" />
            <span>Minimize Player</span>
          </button>

          <div className={`text-xs font-semibold tracking-wide ${mutedFgClass}`}>
            Now Playing · {currentTrack.qualityLabel || currentTrack.source.toUpperCase()}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowEqModal(true)}
              aria-label="Open 10-band Equalizer"
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl backdrop-blur-md text-xs font-semibold transition-colors cursor-pointer ${highContrastBtnClass}`}
            >
              <Sliders className="w-4 h-4" />
              <span>10-Band EQ</span>
            </button>
            <button
              type="button"
              onClick={toggleAppFullscreen}
              aria-label="Exit fullscreen to Cinema window"
              title="Restore Cinema Window (F11)"
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl backdrop-blur-md text-xs font-semibold transition-colors cursor-pointer ${highContrastBtnClass}`}
            >
              <Minimize2 className="w-4 h-4" />
              <span>Restore Window</span>
            </button>
          </div>
        </header>
      )}

      {/* Main Split Stage */}
      <main className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 px-6 sm:px-10 lg:px-16 py-4 overflow-hidden items-center">
        {/* Left: Artwork + Spectrum Visualizer + Track Metadata */}
        <div className="flex flex-col items-center justify-center max-w-md mx-auto w-full min-w-0">
          <div className="w-56 h-56 sm:w-72 sm:h-72 lg:w-80 lg:h-80 rounded-3xl overflow-hidden shadow-2xl border border-white/10 mb-5 bg-black/40">
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

          <div className="w-full flex items-center justify-between gap-4 min-w-0">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl sm:text-2xl font-bold truncate">{currentTrack.title}</h2>
              <button
                type="button"
                onClick={() => {
                  setFullscreenPlayer(false);
                  navigate('artist', currentTrack.artist);
                }}
                className={`text-sm ${mutedFgClass} hover:underline truncate block max-w-full text-left cursor-pointer`}
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
          <div className="flex items-center justify-between gap-3 px-4 pb-3 shrink-0">
            <div
              role="tablist"
              aria-label="Cinema secondary panel"
              className={`inline-flex items-center p-1 rounded-xl border backdrop-blur-md ${
                isSolidTheme
                  ? 'bg-[var(--md-surface-container)] border-[var(--md-outline-variant)]/50'
                  : 'bg-white/10 border-white/10'
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
                {queue.length > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono-tabular ${
                      rightTab === 'QUEUE'
                        ? 'bg-black/20 text-current'
                        : 'bg-white/15 text-current'
                    }`}
                  >
                    {queue.length}
                  </span>
                )}
              </button>
            </div>

            {rightTab === 'LYRICS' && hasAlternateLanguage && (
              <button
                type="button"
                onClick={() => void toggleLyricsLanguage()}
                aria-label={
                  settings.lyricsLanguage === 'ENGLISH'
                    ? 'Switch to original native language lyrics'
                    : 'Switch to English transliterated lyrics'
                }
                title={
                  settings.lyricsLanguage === 'ENGLISH'
                    ? 'Currently showing English. Click for Native.'
                    : 'Currently showing Native. Click for English.'
                }
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  settings.lyricsLanguage === 'ENGLISH'
                    ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)] shadow-sm'
                    : 'bg-white/10 text-white/90 hover:bg-white/20'
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{settings.lyricsLanguage === 'ENGLISH' ? 'English' : 'Native'}</span>
              </button>
            )}

            {rightTab === 'QUEUE' && queue.length > 1 && (
              <button
                type="button"
                onClick={clearQueue}
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
                  {settings.lyricsLanguage === 'ENGLISH' &&
                  activeTrackLyrics.englishLyrics &&
                  activeTrackLyrics.englishLyrics.length > 0
                    ? activeTrackLyrics.englishLyrics.join('\n')
                    : activeTrackLyrics.plainLyrics}
                </pre>
              ) : (
                <div className={`text-center text-sm ${mutedFgClass} pt-20`}>
                  No lyrics available for this track.
                </div>
              )}
            </div>
          ) : (
            <UpNextQueueView variant="cinema" isSolidTheme={isSolidTheme} />
          )}
        </div>
      </main>

      {/* Bottom Transport & Utility Dock */}
      <footer className="relative z-10 px-6 sm:px-10 lg:px-14 pb-7 pt-2 w-full max-w-6xl mx-auto">
        <div className={`flex items-center gap-3 text-xs font-mono-tabular ${mutedFgClass} mb-4`}>
          <span className="w-10 text-right">{formatTime(positionSec)}</span>
          <SeekBarSlider
            sliderStyle={settings.sliderStyle}
            positionSec={positionSec}
            durationSec={durationSec}
            isPlaying={isPlaying}
            onSeek={seekTo}
            ariaLabel="Seek position"
            step={0.25}
            trackBgColor="rgba(128,128,128,0.28)"
            className="flex-1"
          />
          <span className="w-10">{formatTime(durationSec)}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 items-center gap-4">
          <div className="hidden md:flex items-center gap-2 min-w-0">
            {queue.length > 0 && queueIndex >= 0 && (
              <button
                type="button"
                onClick={() => setRightTab('QUEUE')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors ${highContrastBtnClass}`}
              >
                <ListMusic className="w-3.5 h-3.5" />
                <span>
                  Track {queueIndex + 1} of {queue.length}
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
                    : `Sleep: ${sleepTimerMinLeft}m`}
                </span>
              </button>
            )}
          </div>

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

          <div className="flex items-center justify-center md:justify-end gap-1.5">
            <button
              type="button"
              onClick={openMiniPlayer}
              aria-label="Switch to Mini-Player"
              title="Switch to Mini-Player"
              className={`p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer ${mutedFgClass}`}
            >
              <PictureInPicture2 className="w-4.5 h-4.5" />
            </button>

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
                {hasActiveSleep && sleepTimerMinLeft !== null && !sleepEndOfTrack && (
                  <span className="text-[11px] font-mono-tabular font-semibold">
                    {sleepTimerMinLeft}m
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
                        : !sleepEndOfTrack && sleepTimerMinLeft === preset.minutes;

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