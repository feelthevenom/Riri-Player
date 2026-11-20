import React, { useEffect, useMemo, useState } from 'react';
import {
  Heart,
  Lock,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Unlock,
  X,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { MiniOverlayTheme, SliderStyle, ThemeSurfaceStyle, Track } from '../types/music';
import { FALLBACK_ARTWORK_DATA_URL, OVERLAY_THEME_CLASSES } from '../data/catalog';
import { findActiveLyricIndex, formatTime, parseLrcLyrics } from '../utils/lyricsParser';
import { SeekBarSlider } from './SeekBarSlider';
import {
  applyMaterialTheme,
  buildAlbumGradientTheme,
  extractPaletteFromArtwork,
} from '../utils/themeEngine';

interface MiniPlayerCardProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  miniOverlayTheme: MiniOverlayTheme;
  sliderStyle?: SliderStyle;
  themeSeedColor: string;
  activeLyricLine?: string | null;
  liked?: boolean;
  isLocked: boolean;
  onToggleLock: () => void;
  onPrev: () => void;
  onTogglePlayPause: () => void;
  onNext: () => void;
  onSeek: (sec: number) => void;
  onToggleLike?: () => void;
  onOpenCinemaView: () => void;
  onClose: () => void;
  dragRegion?: boolean;
  fullWindow?: boolean;
}

const MiniPlayerCard: React.FC<MiniPlayerCardProps> = ({
  currentTrack,
  isPlaying,
  positionSec,
  durationSec,
  miniOverlayTheme,
  sliderStyle = 'WAVY',
  themeSeedColor,
  activeLyricLine,
  liked = false,
  isLocked,
  onToggleLock,
  onPrev,
  onTogglePlayPause,
  onNext,
  onSeek,
  onToggleLike,
  onOpenCinemaView,
  onClose,
  dragRegion = false,
  fullWindow = false,
}) => {
  const [dynamicPalette, setDynamicPalette] = useState<{
    primary: string;
    secondary: string;
  } | null>(null);

  const isDynamicAccent = miniOverlayTheme === 'DYNAMIC_ACCENT';

  useEffect(() => {
    if (!isDynamicAccent) {
      setDynamicPalette(null);
      return;
    }
    const fallback = themeSeedColor || '#ED5564';
    if (!currentTrack?.thumbnailUrl) {
      setDynamicPalette({ primary: fallback, secondary: '#1A0E10' });
      return;
    }
    let cancelled = false;
    extractPaletteFromArtwork(currentTrack.thumbnailUrl, fallback)
      .then((palette) => {
        if (!cancelled) {
          setDynamicPalette({ primary: palette.primary, secondary: palette.secondary });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDynamicPalette({ primary: fallback, secondary: '#1A0E10' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isDynamicAccent, currentTrack?.thumbnailUrl, themeSeedColor]);

  const dynamicTheme = useMemo(() => {
    if (!isDynamicAccent) return null;
    const palette = dynamicPalette || {
      primary: themeSeedColor || '#ED5564',
      secondary: '#1A0E10',
    };
    return buildAlbumGradientTheme(palette.primary, palette.secondary);
  }, [isDynamicAccent, dynamicPalette, themeSeedColor]);

  const themeCfg = isDynamicAccent
    ? {
        container: 'border text-white transition-[background,border-color,box-shadow] duration-500',
        muted: 'text-white/80',
      }
    : OVERLAY_THEME_CLASSES[miniOverlayTheme] || OVERLAY_THEME_CLASSES.GLASS;

  const playBtnStyle = dynamicTheme
    ? { backgroundColor: dynamicTheme.primary, color: dynamicTheme.onPrimary }
    : undefined;
  const playBtnClass = dynamicTheme
    ? 'w-9 h-9 rounded-full flex items-center justify-center cursor-pointer shadow-md transition-transform hover:scale-105 active:scale-95'
    : 'w-9 h-9 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center cursor-pointer shadow-md transition-transform hover:scale-105 active:scale-95';

  const cardStyle: React.CSSProperties = {
    ...(dragRegion
      ? ({ WebkitAppRegion: isLocked ? 'no-drag' : 'drag' } as React.CSSProperties)
      : {}),
    ...(dynamicTheme
      ? {
          background: dynamicTheme.background,
          borderColor: dynamicTheme.borderColor,
          boxShadow: dynamicTheme.boxShadow,
        }
      : {}),
  };

  const noDrag = dragRegion ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined;

  return (
    <div
      data-mini-overlay="true"
      role="region"
      aria-label="Riri Player Mini-Player"
      style={cardStyle}
      className={`${
        fullWindow ? 'w-screen h-screen rounded-2xl' : 'w-[392px] max-w-[calc(100vw-24px)] rounded-2xl shadow-2xl'
      } select-none overflow-hidden p-4 flex flex-col justify-between gap-3 ${themeCfg.container}`}
    >
      {/* Top Bar: Title, Lock & Close (returns to main app) */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-current/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 rounded-md bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center font-bold text-[10px] shrink-0">
            RP
          </span>
          <span className={`text-xs font-semibold truncate ${themeCfg.muted}`}>
            Riri Mini-Player
          </span>
          {isLocked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
              Locked
            </span>
          )}
        </div>

        <div style={noDrag} className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleLock}
            title={
              isLocked
                ? 'Locked: Position cannot move (Click to unlock)'
                : 'Unlocked: Click to lock in place'
            }
            aria-label={isLocked ? 'Unlock mini-player' : 'Lock mini-player'}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isLocked
                ? 'bg-amber-500/25 text-amber-300 hover:bg-amber-500/35'
                : `hover:bg-current/10 ${themeCfg.muted}`
            }`}
          >
            {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Return to main Riri Player"
            title="Close Mini-Player and return to app"
            className={`p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-300 transition-colors cursor-pointer ${themeCfg.muted}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Artwork + Metadata + Transport Controls */}
      <div className="flex items-center gap-3">
        <img
          src={currentTrack?.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
          alt={currentTrack?.title || 'No track'}
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
          }}
          className="w-12 h-12 rounded-xl object-cover shrink-0 bg-black/30 shadow-md ring-1 ring-white/15"
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">
            {currentTrack?.title || 'No Track Playing'}
          </div>
          <div className={`text-xs truncate ${themeCfg.muted}`}>
            {currentTrack ? currentTrack.artist : 'Play music to control here'}
          </div>
        </div>

        <div style={noDrag} className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Mini-player previous track"
            className="p-1.5 rounded-lg hover:bg-current/10 cursor-pointer"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>
          <button
            type="button"
            onClick={onTogglePlayPause}
            aria-label={isPlaying ? 'Mini-player pause' : 'Mini-player play'}
            className={playBtnClass}
            style={playBtnStyle}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Mini-player next track"
            className="p-1.5 rounded-lg hover:bg-current/10 cursor-pointer"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>

      {/* Synced Lyric Line + Seek Bar + Footer Actions */}
      <div style={noDrag} className="space-y-2">
        {activeLyricLine && (
          <div
            className="text-[11px] font-medium truncate"
            style={{ color: dynamicTheme ? dynamicTheme.accentText : 'var(--md-primary)' }}
          >
            {activeLyricLine}
          </div>
        )}

        <div className={`flex items-center gap-2 text-[10px] font-mono-tabular ${themeCfg.muted}`}>
          <span>{formatTime(positionSec)}</span>
          <SeekBarSlider
            sliderStyle={sliderStyle}
            positionSec={positionSec}
            durationSec={durationSec}
            isPlaying={isPlaying}
            onSeek={onSeek}
            ariaLabel="Mini-player seek bar"
            step={0.5}
            accentColor={dynamicTheme ? dynamicTheme.primary : 'var(--md-primary)'}
            trackBgColor={dynamicTheme ? dynamicTheme.primaryRgba : 'rgba(128,128,128,0.3)'}
            className="flex-1"
          />
          <span>{formatTime(durationSec)}</span>
        </div>

        <div className="flex items-center justify-between pt-0.5">
          {currentTrack && onToggleLike ? (
            <button
              type="button"
              onClick={onToggleLike}
              style={liked && dynamicTheme ? { color: dynamicTheme.accentText } : undefined}
              className={`flex items-center gap-1 text-[11px] font-medium cursor-pointer ${
                liked ? (dynamicTheme ? '' : 'text-[var(--md-primary)]') : themeCfg.muted
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${liked ? 'fill-current' : ''}`} />
              <span>{liked ? 'Liked' : 'Like'}</span>
            </button>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={onOpenCinemaView}
            className={`flex items-center gap-1.5 text-[11px] font-semibold hover:underline cursor-pointer ${themeCfg.muted}`}
          >
            <Maximize2 className="w-3 h-3" />
            <span>Cinema View</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// Web unified Mini-Player view (hides main application while active; Close or Cinema View returns to app)
export const MiniPlayerOverlay: React.FC = () => {
  const {
    showMiniOverlay,
    closeMiniPlayer,
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    isTrackLiked,
    toggleLike,
    settings,
    activeTrackLyrics,
  } = useRiriPlayer();

  const [isLocked, setIsLocked] = useState(false);

  const parsedLyrics = useMemo(
    () => parseLrcLyrics(activeTrackLyrics.syncedLyrics),
    [activeTrackLyrics.syncedLyrics],
  );
  const activeLyricIdx = useMemo(
    () => findActiveLyricIndex(parsedLyrics, positionSec * 1000, settings.lyricsOffsetMs),
    [parsedLyrics, positionSec, settings.lyricsOffsetMs],
  );
  const activeLyricLine = activeLyricIdx >= 0 ? parsedLyrics[activeLyricIdx]?.text : null;

  if (!showMiniOverlay) return null;

  const liked = currentTrack ? isTrackLiked(currentTrack.id) : false;

  return (
    <div className="min-h-screen w-screen bg-[var(--md-background)] text-[var(--md-on-surface)] flex flex-col items-center justify-center p-4">
      <MiniPlayerCard
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        positionSec={positionSec}
        durationSec={durationSec}
        miniOverlayTheme={settings.miniOverlayTheme}
        sliderStyle={settings.sliderStyle}
        themeSeedColor={settings.themeColor}
        activeLyricLine={activeLyricLine}
        liked={liked}
        isLocked={isLocked}
        onToggleLock={() => setIsLocked((v) => !v)}
        onPrev={() => void prevTrack()}
        onTogglePlayPause={() => void togglePlayPause()}
        onNext={() => void nextTrack()}
        onSeek={seekTo}
        onToggleLike={
          currentTrack ? () => toggleLike(currentTrack.id, currentTrack) : undefined
        }
        onOpenCinemaView={() => closeMiniPlayer(true)}
        onClose={() => closeMiniPlayer(false)}
      />
    </div>
  );
};

// Standalone Always-On-Top Electron Mini-Player Window (#/mini-overlay)
export const StandaloneMiniOverlayWindow: React.FC = () => {
  const [state, setState] = useState<{
    currentTrack: Track | null;
    isPlaying: boolean;
    positionSec: number;
    durationSec: number;
    miniOverlayTheme: MiniOverlayTheme;
    sliderStyle?: SliderStyle;
    themeSeedColor?: string;
    darkMode?: 'DARK' | 'LIGHT' | 'SYSTEM';
    themeSurfaceStyle?: ThemeSurfaceStyle;
  }>({
    currentTrack: null,
    isPlaying: false,
    positionSec: 0,
    durationSec: 0,
    miniOverlayTheme: 'GLASS',
    sliderStyle: 'WAVY',
    themeSeedColor: '#ed5564',
    darkMode: 'DARK',
  });

  const [isLocked, setIsLocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem('riri_overlay_locked') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const electronApi = (
      window as unknown as {
        electronAPI?: { setOverlayMovable?: (movable: boolean) => void };
      }
    ).electronAPI;
    electronApi?.setOverlayMovable?.(!isLocked);
    try {
      localStorage.setItem('riri_overlay_locked', String(isLocked));
    } catch {
      // ignore
    }
  }, [isLocked]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('riri_mini_overlay');
    ch.onmessage = (e: MessageEvent<{ type?: string; payload?: typeof state }>) => {
      if (e.data?.type === 'STATE' && e.data.payload) {
        const p = e.data.payload;
        setState((prev) => ({ ...prev, ...p }));
        if (p.themeSeedColor) {
          applyMaterialTheme(
            p.themeSeedColor,
            p.darkMode || 'DARK',
            false,
            p.themeSurfaceStyle || 'GLASS',
          );
        }
      }
    };
    ch.postMessage({ type: 'REQUEST_STATE' });
    return () => ch.close();
  }, []);

  const sendCmd = (action: 'toggle' | 'next' | 'prev' | 'open-cinema') => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('riri_mini_overlay');
    ch.postMessage({ type: 'CMD', action });
    ch.close();
  };

  const sendSeek = (positionSec: number) => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('riri_mini_overlay');
    ch.postMessage({ type: 'CMD', action: 'seek', positionSec });
    ch.close();
  };

  const handleReturnToApp = (openCinema: boolean) => {
    const electronApi = (
      window as unknown as {
        electronAPI?: {
          restoreFromMiniPlayer?: (openCinema: boolean) => void;
          closeOverlayWindow?: () => void;
        };
      }
    ).electronAPI;
    if (openCinema) {
      sendCmd('open-cinema');
    }
    if (electronApi?.restoreFromMiniPlayer) {
      electronApi.restoreFromMiniPlayer(openCinema);
    } else if (electronApi?.closeOverlayWindow) {
      electronApi.closeOverlayWindow();
    } else {
      window.close();
    }
  };

  return (
    <MiniPlayerCard
      currentTrack={state.currentTrack}
      isPlaying={state.isPlaying}
      positionSec={state.positionSec}
      durationSec={state.durationSec}
      miniOverlayTheme={state.miniOverlayTheme}
      sliderStyle={state.sliderStyle || 'WAVY'}
      themeSeedColor={state.themeSeedColor || '#ed5564'}
      isLocked={isLocked}
      onToggleLock={() => setIsLocked((prev) => !prev)}
      onPrev={() => sendCmd('prev')}
      onTogglePlayPause={() => sendCmd('toggle')}
      onNext={() => sendCmd('next')}
      onSeek={(pos) => {
        setState((prev) => ({ ...prev, positionSec: pos }));
        sendSeek(pos);
      }}
      onOpenCinemaView={() => handleReturnToApp(true)}
      onClose={() => handleReturnToApp(false)}
      dragRegion
      fullWindow
    />
  );
};