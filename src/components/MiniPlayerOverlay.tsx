import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GripHorizontal,
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
import { useArchiveTune } from '../context/ArchiveTuneContext';
import { MiniOverlayTheme, ThemeSurfaceStyle, Track } from '../types/music';
import { FALLBACK_ARTWORK_DATA_URL, OVERLAY_THEME_CLASSES } from '../data/catalog';
import { findActiveLyricIndex, formatTime, parseLrcLyrics } from '../utils/lyricsParser';
import {
  applyMaterialTheme,
  buildAlbumGradientTheme,
  extractPaletteFromArtwork,
} from '../utils/themeEngine';

const POS_STORAGE_KEY = 'archivetune_mini_overlay_pos_v1';

export const MiniPlayerOverlay: React.FC = () => {
  const {
    showMiniOverlay,
    setShowMiniOverlay,
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
    setFullscreenPlayer,
    settings,
    updateSettings,
    activeTrackLyrics,
    showToast,
  } = useArchiveTune();

  const [expanded, setExpanded] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [dynamicPalette, setDynamicPalette] = useState<{
    primary: string;
    secondary: string;
  } | null>(null);

  const [freePos, setFreePos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(POS_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as { x: number; y: number };
    } catch {
      // ignore
    }
    return { x: 24, y: 80 };
  });

  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(freePos));
    } catch {
      // ignore
    }
  }, [freePos]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nextX = Math.max(12, Math.min(vw - 360, dragStartRef.current.origX + dx));
      const nextY = Math.max(12, Math.min(vh - 180, dragStartRef.current.origY + dy));
      setFreePos({ x: nextX, y: nextY });
    };
    const onMouseUp = () => {
      dragStartRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const isDynamicAccent = settings.miniOverlayTheme === 'DYNAMIC_ACCENT';

  useEffect(() => {
    if (!isDynamicAccent) {
      setDynamicPalette(null);
      return;
    }
    if (!currentTrack?.thumbnailUrl) {
      setDynamicPalette({
        primary: settings.themeColor || '#ED5564',
        secondary: '#1A0E10',
      });
      return;
    }
    let cancelled = false;
    extractPaletteFromArtwork(currentTrack.thumbnailUrl, settings.themeColor || '#ED5564')
      .then((palette) => {
        if (!cancelled) {
          setDynamicPalette({
            primary: palette.primary,
            secondary: palette.secondary,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDynamicPalette({
            primary: settings.themeColor || '#ED5564',
            secondary: '#1A0E10',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isDynamicAccent, currentTrack?.thumbnailUrl, settings.themeColor]);

  const dynamicTheme = useMemo(() => {
    if (!isDynamicAccent) return null;
    const palette = dynamicPalette || {
      primary: settings.themeColor || '#ED5564',
      secondary: '#1A0E10',
    };
    return buildAlbumGradientTheme(palette.primary, palette.secondary);
  }, [isDynamicAccent, dynamicPalette, settings.themeColor]);

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

  const themeCfg = isDynamicAccent
    ? {
        container: 'border text-white transition-[background,border-color,box-shadow] duration-500',
        muted: 'text-white/80',
      }
    : OVERLAY_THEME_CLASSES[settings.miniOverlayTheme] || OVERLAY_THEME_CLASSES.GLASS;

  const liked = currentTrack ? isTrackLiked(currentTrack.id) : false;
  const pct = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;

  const playBtnStyle = dynamicTheme
    ? { backgroundColor: dynamicTheme.primary, color: dynamicTheme.onPrimary }
    : undefined;
  const playBtnClass = dynamicTheme
    ? 'w-8 h-8 rounded-full flex items-center justify-center cursor-pointer shadow-md transition-transform hover:scale-105 active:scale-95'
    : 'w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center cursor-pointer';

  const seekBarBg = dynamicTheme
    ? `linear-gradient(to right, ${dynamicTheme.primary} ${pct}%, ${dynamicTheme.primaryRgba} ${pct}%)`
    : `linear-gradient(to right, var(--md-primary) ${pct}%, rgba(128,128,128,0.3) ${pct}%)`;

  const seekBarStyle: React.CSSProperties = dynamicTheme
    ? { background: seekBarBg, accentColor: dynamicTheme.primary }
    : { background: seekBarBg };

  const toggleLock = () => setIsLocked((prev) => !prev);

  const handleDragStart = (e: React.MouseEvent) => {
    if (isLocked) return;
    const rect = (
      e.currentTarget.closest('[data-mini-overlay]') as HTMLElement
    )?.getBoundingClientRect();
    const origX = rect ? rect.left : freePos.x;
    const origY = rect ? rect.top : freePos.y;
    if (settings.miniOverlayPin !== 'FREE') {
      updateSettings({ miniOverlayPin: 'FREE' });
    }
    setFreePos({ x: origX, y: origY });
    dragStartRef.current = { startX: e.clientX, startY: e.clientY, origX, origY };
  };

  const pinPositionStyle: React.CSSProperties = (() => {
    switch (settings.miniOverlayPin) {
      case 'TOP_LEFT':
        return { top: 60, left: 20 };
      case 'TOP_RIGHT':
        return { top: 60, right: 20 };
      case 'BOTTOM_LEFT':
        return { bottom: 104, left: 20 };
      case 'BOTTOM_RIGHT':
        return { bottom: 104, right: 20 };
      case 'FREE':
      default:
        return { top: freePos.y, left: freePos.x };
    }
  })();

  const containerStyle: React.CSSProperties = dynamicTheme
    ? {
        ...pinPositionStyle,
        background: dynamicTheme.background,
        borderColor: dynamicTheme.borderColor,
        boxShadow: dynamicTheme.boxShadow,
      }
    : pinPositionStyle;

  const handleOpenDesktopWindow = () => {
    const api = (
      window as unknown as {
        electronAPI?: { toggleOverlayWindow?: () => void };
      }
    ).electronAPI;
    setShowMiniOverlay(false);
    if (api?.toggleOverlayWindow) {
      api.toggleOverlayWindow();
      showToast('Moved to floating Windows desktop overlay');
    } else {
      showToast('Standalone desktop overlay is available in the desktop app.');
    }
  };

  return (
    <div
      data-mini-overlay="true"
      role="region"
      aria-label="Pinned Mini-Player Overlay"
      style={containerStyle}
      className={`fixed z-50 w-[376px] max-w-[calc(100vw-24px)] rounded-2xl p-3.5 transition-shadow ${themeCfg.container}`}
    >
      {/* Top Bar: Drag Handle, Themes, Lock, Desktop Popout, Collapse, Close */}
      <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-current/10">
        <button
          type="button"
          onMouseDown={handleDragStart}
          title={isLocked ? 'Position is locked in place' : 'Drag anywhere on screen'}
          aria-label={isLocked ? 'Overlay locked' : 'Drag mini-player overlay'}
          className={`flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap shrink-0 ${
            isLocked
              ? 'cursor-default text-amber-300'
              : `cursor-grab active:cursor-grabbing ${themeCfg.muted}`
          }`}
        >
          <GripHorizontal className="w-4 h-4 shrink-0" />
          <span>{isLocked ? 'Locked' : 'Overlay'}</span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <select
            aria-label="Mini-player overlay theme"
            value={settings.miniOverlayTheme}
            onChange={(e) =>
              updateSettings({ miniOverlayTheme: e.target.value as MiniOverlayTheme })
            }
            className="rounded-lg bg-black/25 border border-current/15 px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer focus:outline-none"
          >
            {(Object.keys(OVERLAY_THEME_CLASSES) as MiniOverlayTheme[]).map((t) => (
              <option key={t} value={t} className="bg-zinc-900 text-white">
                {OVERLAY_THEME_CLASSES[t].label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={toggleLock}
            title={
              isLocked
                ? 'Locked: Position cannot move (Click to unlock)'
                : 'Unlocked: Click to lock in place'
            }
            aria-label={isLocked ? 'Unlock overlay' : 'Lock overlay'}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isLocked
                ? 'bg-amber-500/25 text-amber-300 hover:bg-amber-500/35'
                : `hover:bg-current/10 ${dynamicTheme ? 'text-white/80' : 'text-[var(--md-on-surface-variant)]'}`
            }`}
          >
            {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleOpenDesktopWindow}
            title="Move outside to floating Windows Desktop Overlay"
            aria-label="Move overlay outside to Windows desktop"
            className={`p-1.5 rounded-lg hover:bg-current/10 cursor-pointer ${
              dynamicTheme ? 'text-white/80' : 'text-[var(--md-on-surface-variant)]'
            }`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse overlay' : 'Expand overlay'}
            className="p-1 rounded-md hover:bg-current/10 cursor-pointer"
          >
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowMiniOverlay(false)}
            aria-label="Close mini-player overlay"
            className="p-1 rounded-md hover:bg-current/10 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Track Info + Controls */}
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

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => void prevTrack()}
            aria-label="Overlay previous track"
            className="p-1.5 rounded-lg hover:bg-current/10 cursor-pointer"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>
          <button
            type="button"
            onClick={() => void togglePlayPause()}
            aria-label={isPlaying ? 'Overlay pause' : 'Overlay play'}
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
            onClick={() => void nextTrack()}
            aria-label="Overlay next track"
            className="p-1.5 rounded-lg hover:bg-current/10 cursor-pointer"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
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
            <input
              type="range"
              aria-label="Overlay seek bar"
              min={0}
              max={Math.max(1, durationSec)}
              step={0.5}
              value={Math.min(positionSec, durationSec || 1)}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              style={seekBarStyle}
              className="flex-1 h-1 rounded-full appearance-none accent-[var(--md-primary)] cursor-pointer"
            />
            <span>{formatTime(durationSec)}</span>
          </div>
          <div className="flex items-center justify-between pt-0.5">
            {currentTrack ? (
              <button
                type="button"
                onClick={() => toggleLike(currentTrack.id, currentTrack)}
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
            {currentTrack && (
              <button
                type="button"
                onClick={() => setFullscreenPlayer(true)}
                className={`flex items-center gap-1 text-[11px] font-medium hover:underline cursor-pointer ${themeCfg.muted}`}
              >
                <Maximize2 className="w-3 h-3" />
                <span>Cinema View</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Standalone view rendered when Electron opens a dedicated transparent Always-On-Top Windows overlay window (#/mini-overlay)
export const StandaloneMiniOverlayWindow: React.FC = () => {
  const [state, setState] = useState<{
    currentTrack: Track | null;
    isPlaying: boolean;
    positionSec: number;
    durationSec: number;
    miniOverlayTheme: MiniOverlayTheme;
    themeSeedColor?: string;
    darkMode?: 'DARK' | 'LIGHT' | 'SYSTEM';
    themeSurfaceStyle?: ThemeSurfaceStyle;
  }>({
    currentTrack: null,
    isPlaying: false,
    positionSec: 0,
    durationSec: 0,
    miniOverlayTheme: 'GLASS',
    themeSeedColor: '#ed5564',
    darkMode: 'DARK',
  });

  const [isLocked, setIsLocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem('archivetune_overlay_locked') === 'true';
    } catch {
      return false;
    }
  });

  const [dynamicPalette, setDynamicPalette] = useState<{
    primary: string;
    secondary: string;
  } | null>(null);

  useEffect(() => {
    const electronApi = (
      window as unknown as {
        electronAPI?: { setOverlayMovable?: (movable: boolean) => void };
      }
    ).electronAPI;
    electronApi?.setOverlayMovable?.(!isLocked);
    try {
      localStorage.setItem('archivetune_overlay_locked', String(isLocked));
    } catch {
      // ignore
    }
  }, [isLocked]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('archivetune_mini_overlay');
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

  const isDynamicAccent = state.miniOverlayTheme === 'DYNAMIC_ACCENT';

  useEffect(() => {
    if (!isDynamicAccent) {
      setDynamicPalette(null);
      return;
    }
    const fallback = state.themeSeedColor || '#ED5564';
    if (!state.currentTrack?.thumbnailUrl) {
      setDynamicPalette({
        primary: fallback,
        secondary: '#1A0E10',
      });
      return;
    }
    let cancelled = false;
    extractPaletteFromArtwork(state.currentTrack.thumbnailUrl, fallback)
      .then((palette) => {
        if (!cancelled) {
          setDynamicPalette({
            primary: palette.primary,
            secondary: palette.secondary,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDynamicPalette({
            primary: fallback,
            secondary: '#1A0E10',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isDynamicAccent, state.currentTrack?.thumbnailUrl, state.themeSeedColor]);

  const dynamicTheme = useMemo(() => {
    if (!isDynamicAccent) return null;
    const palette = dynamicPalette || {
      primary: state.themeSeedColor || '#ED5564',
      secondary: '#1A0E10',
    };
    return buildAlbumGradientTheme(palette.primary, palette.secondary);
  }, [isDynamicAccent, dynamicPalette, state.themeSeedColor]);

  const sendCmd = (action: 'toggle' | 'next' | 'prev') => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('archivetune_mini_overlay');
    ch.postMessage({ type: 'CMD', action });
    ch.close();
  };

  const sendSeek = (positionSec: number) => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('archivetune_mini_overlay');
    ch.postMessage({ type: 'CMD', action: 'seek', positionSec });
    ch.close();
  };

  const handleClose = () => {
    const electronApi = (
      window as unknown as {
        electronAPI?: { closeOverlayWindow?: () => void };
      }
    ).electronAPI;
    if (electronApi?.closeOverlayWindow) {
      electronApi.closeOverlayWindow();
    } else {
      window.close();
    }
  };

  const theme = isDynamicAccent
    ? {
        container: 'border text-white transition-[background,border-color] duration-500',
        muted: 'text-white/80',
      }
    : OVERLAY_THEME_CLASSES[state.miniOverlayTheme] || OVERLAY_THEME_CLASSES.GLASS;

  const pct =
    state.durationSec > 0 ? Math.min(100, (state.positionSec / state.durationSec) * 100) : 0;

  const playBtnStyle = dynamicTheme
    ? { backgroundColor: dynamicTheme.primary, color: dynamicTheme.onPrimary }
    : undefined;
  const playBtnClass = dynamicTheme
    ? 'w-8 h-8 rounded-full flex items-center justify-center cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-transform'
    : 'w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-transform';

  const seekBarBg = dynamicTheme
    ? `linear-gradient(to right, ${dynamicTheme.primary} ${pct}%, ${dynamicTheme.primaryRgba} ${pct}%)`
    : `linear-gradient(to right, var(--md-primary) ${pct}%, rgba(128,128,128,0.25) ${pct}%)`;

  const seekBarStyle: React.CSSProperties = dynamicTheme
    ? { background: seekBarBg, accentColor: dynamicTheme.primary }
    : { background: seekBarBg };

  const rootStyle: React.CSSProperties = dynamicTheme
    ? ({
        WebkitAppRegion: isLocked ? 'no-drag' : 'drag',
        background: dynamicTheme.background,
        borderColor: dynamicTheme.borderColor,
        boxShadow: dynamicTheme.boxShadow,
      } as React.CSSProperties)
    : ({
        WebkitAppRegion: isLocked ? 'no-drag' : 'drag',
      } as React.CSSProperties);

  return (
    <div
      className={`w-screen h-screen select-none overflow-hidden rounded-2xl p-3.5 flex flex-col justify-between border border-white/15 ${theme.container}`}
      style={rootStyle}
    >
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <div className="flex items-center gap-1.5">
          <span className={theme.muted}>ArchiveTune Desktop Overlay</span>
          {isLocked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
              Locked
            </span>
          )}
        </div>
        <div
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1"
        >
          <button
            type="button"
            onClick={() => setIsLocked((prev) => !prev)}
            aria-label={isLocked ? 'Unlock overlay to move' : 'Lock overlay position'}
            title={
              isLocked
                ? 'Locked: Position is fixed (Click to unlock)'
                : 'Unlocked: Click to lock in place'
            }
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isLocked
                ? 'bg-amber-500/25 text-amber-300 hover:bg-amber-500/35'
                : `hover:bg-current/10 ${dynamicTheme ? 'text-white/80' : 'text-[var(--md-on-surface-variant)]'}`
            }`}
          >
            {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close Windows overlay"
            title="Close overlay"
            className={`p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-300 transition-colors cursor-pointer ${
              dynamicTheme ? 'text-white/80' : 'text-[var(--md-on-surface-variant)]'
            }`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <img
          src={state.currentTrack?.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
          alt={state.currentTrack?.title || 'Track'}
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
          }}
          className="w-11 h-11 rounded-xl object-cover shrink-0 shadow-md ring-1 ring-white/15 bg-black/30"
        />
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm font-semibold truncate ${
              dynamicTheme ? 'text-white' : 'text-[var(--md-on-surface)]'
            }`}
          >
            {state.currentTrack?.title || 'No song playing'}
          </div>
          <div className={`text-xs truncate ${theme.muted}`}>
            {state.currentTrack?.artist || 'ArchiveTune Desktop Client'}
          </div>
        </div>
        <div
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1"
        >
          <button
            type="button"
            onClick={() => sendCmd('prev')}
            aria-label="Previous track"
            className="p-1.5 rounded-lg hover:bg-current/10 cursor-pointer transition-colors"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>
          <button
            type="button"
            onClick={() => sendCmd('toggle')}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
            className={playBtnClass}
            style={playBtnStyle}
          >
            {state.isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => sendCmd('next')}
            aria-label="Next track"
            className="p-1.5 rounded-lg hover:bg-current/10 cursor-pointer transition-colors"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>

      {/* Interactive Seek Bar Level Control */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="w-full flex items-center gap-2 text-[10px] font-mono-tabular"
      >
        <span className={theme.muted}>{formatTime(state.positionSec)}</span>
        <input
          type="range"
          aria-label="Timeline seek"
          min={0}
          max={Math.max(1, state.durationSec)}
          step={0.5}
          value={Math.min(state.positionSec, state.durationSec || 1)}
          onChange={(e) => {
            const newPos = parseFloat(e.target.value);
            setState((prev) => ({ ...prev, positionSec: newPos }));
            sendSeek(newPos);
          }}
          style={seekBarStyle}
          className="flex-1 h-1.5 rounded-full appearance-none accent-[var(--md-primary)] cursor-pointer"
        />
        <span className={theme.muted}>{formatTime(state.durationSec)}</span>
      </div>
    </div>
  );
};