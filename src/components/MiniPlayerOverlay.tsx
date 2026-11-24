import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Heart,
  Maximize2,
  Mic,
  MicOff,
  Minus,
  Pause,
  Pin,
  PinOff,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import {
  MiniOverlayTheme,
  SliderStyle,
  ThemeSurfaceStyle,
  Track,
} from '../types/music';
import { FALLBACK_ARTWORK_DATA_URL, OVERLAY_THEME_CLASSES } from '../data/catalog';
import { findActiveLyricIndex, formatTime, parseLrcLyrics } from '../utils/lyricsParser';
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
  liked: boolean;
  repeatMode: 'OFF' | 'ALL' | 'ONE';
  shuffleEnabled: boolean;
  volume: number;
  isLocked: boolean;
  lyricsLanguage: 'NATIVE' | 'ENGLISH';
  onToggleLock: () => void;
  onPrev: () => void;
  onTogglePlayPause: () => void;
  onNext: () => void;
  onCycleRepeatMode: () => void;
  onToggleShuffle: () => void;
  onToggleLyricsLanguage: () => void;
  onSeek: (sec: number) => void;
  onSetVolume: (vol: number) => void;
  onToggleLike?: () => void;
  onOpenCinemaView: () => void;
  onMinimize?: () => void;
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
  sliderStyle = 'DEFAULT',
  themeSeedColor,
  activeLyricLine,
  liked = false,
  repeatMode = 'OFF',
  shuffleEnabled = false,
  volume = 0.85,
  lyricsLanguage = 'NATIVE',
  isLocked,
  onToggleLock,
  onPrev,
  onTogglePlayPause,
  onNext,
  onCycleRepeatMode,
  onToggleShuffle,
  onToggleLyricsLanguage,
  onSeek,
  onSetVolume,
  onToggleLike,
  onOpenCinemaView,
  onMinimize,
  onClose,
  dragRegion = false,
  fullWindow = false,
}) => {
  const [artworkPalette, setArtworkPalette] = useState<{
    primary: string;
    secondary: string;
  } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const lastNonZeroVolumeRef = useRef<number>(volume > 0 ? volume : 0.85);

  useEffect(() => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
      setIsMuted(false);
    }
  }, [volume]);

  const isGlassTheme = miniOverlayTheme === 'GLASS';
  const isLightTheme = miniOverlayTheme === 'LIGHT';
  const isDynamicAccent = miniOverlayTheme === 'DYNAMIC_ACCENT';
  const displayVolume = isMuted ? 0 : Math.min(1, Math.max(0, volume));

  // Extract artwork palette for Dynamic Accent, Glass, and Riri Glass themes
  useEffect(() => {
    if (
      !isDynamicAccent &&
      !isGlassTheme &&
      miniOverlayTheme !== 'RIRI_GLASS'
    ) {
      setArtworkPalette(null);
      return;
    }
    const fallback = themeSeedColor || '#ED5564';
    if (!currentTrack?.thumbnailUrl) {
      setArtworkPalette({ primary: fallback, secondary: '#1A0E10' });
      return;
    }
    let cancelled = false;
    extractPaletteFromArtwork(currentTrack.thumbnailUrl, fallback)
      .then((palette) => {
        if (!cancelled) {
          setArtworkPalette({ primary: palette.primary, secondary: palette.secondary });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setArtworkPalette({ primary: fallback, secondary: '#1A0E10' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    isDynamicAccent,
    isGlassTheme,
    miniOverlayTheme,
    currentTrack?.thumbnailUrl,
    themeSeedColor,
  ]);

  const dynamicTheme = useMemo(() => {
    if (!isDynamicAccent) return null;
    const palette = artworkPalette || {
      primary: themeSeedColor || '#ED5564',
      secondary: '#1A0E10',
    };
    return buildAlbumGradientTheme(palette.primary, palette.secondary);
  }, [isDynamicAccent, artworkPalette, themeSeedColor]);

  const containerClass = isDynamicAccent
    ? 'border text-white transition-[background,border-color,box-shadow] duration-500'
    : OVERLAY_THEME_CLASSES[miniOverlayTheme]?.container ||
      OVERLAY_THEME_CLASSES.GLASS.container;

  const primaryTextClass = isLightTheme
    ? 'text-[#181416]'
    : isGlassTheme || isDynamicAccent || miniOverlayTheme === 'DARK' || miniOverlayTheme === 'PURE_BLACK' || miniOverlayTheme === 'ACCENT'
      ? 'text-white'
      : 'text-[var(--md-on-surface)]';

  const secondaryTextClass = isLightTheme
    ? 'text-[#57484D]'
    : isGlassTheme
      ? 'text-white/65'
      : isDynamicAccent || miniOverlayTheme === 'ACCENT'
        ? 'text-white/75'
        : 'text-[var(--md-on-surface-variant)]';

  const accentColor = dynamicTheme ? dynamicTheme.primary : 'var(--md-primary)';

  // Parse hex color to RGB components for CSS variable usage
  const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 237, g: 85, b: 100 };
  };

  const palettePrimary = artworkPalette?.primary ?? themeSeedColor ?? '#ED5564';
  const paletteSecondary = artworkPalette?.secondary ?? '#1A0E10';
  const primaryRgb = hexToRgb(palettePrimary);
  const secondaryRgb = hexToRgb(paletteSecondary);

  const cardStyle: React.CSSProperties = {
    ...(dragRegion
      ? ({ WebkitAppRegion: isLocked ? 'no-drag' : 'drag' } as React.CSSProperties)
      : {}),
    ...(miniOverlayTheme === 'RIRI_GLASS'
      ? {
          '--riri-glass-primary-r': primaryRgb.r,
          '--riri-glass-primary-g': primaryRgb.g,
          '--riri-glass-primary-b': primaryRgb.b,
          '--riri-glass-secondary-r': secondaryRgb.r,
          '--riri-glass-secondary-g': secondaryRgb.g,
          '--riri-glass-secondary-b': secondaryRgb.b,
          borderColor: `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.35)`,
        }
      : {}),
    ...(isGlassTheme
      ? {
          backgroundColor: 'rgba(24, 24, 29, 0.62)',
          backdropFilter: 'blur(36px) saturate(190%)',
          WebkitBackdropFilter: 'blur(36px) saturate(190%)',
          borderColor: 'rgba(255, 255, 255, 0.22)',
          boxShadow:
            '0 20px 44px -10px rgba(0, 0, 0, 0.65), inset 0 1px 0 0 rgba(255, 255, 255, 0.34), inset 0 0 0 0.5px rgba(255, 255, 255, 0.10)',
        }
      : {}),
    ...(dynamicTheme
      ? {
          background: dynamicTheme.background,
          borderColor: dynamicTheme.borderColor,
          boxShadow: dynamicTheme.boxShadow,
        }
      : {}),
  };

  const noDrag = dragRegion
    ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties)
    : undefined;

  const playButtonStyle: React.CSSProperties = dynamicTheme
    ? {
        backgroundColor: dynamicTheme.primary,
        color: dynamicTheme.onPrimary || '#ffffff',
        boxShadow: `0 6px 18px -2px ${dynamicTheme.primary}85`,
      }
    : {
        boxShadow: '0 6px 18px -2px color-mix(in srgb, var(--md-primary) 50%, transparent)',
      };

  const handleToggleMute = () => {
    if (isMuted || displayVolume === 0) {
      const restore = lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : 0.85;
      setIsMuted(false);
      onSetVolume(restore);
    } else {
      lastNonZeroVolumeRef.current = displayVolume;
      setIsMuted(true);
      onSetVolume(0);
    }
  };

  return (
    <div
      data-mini-overlay="true"
      role="region"
      aria-label="Riri Player Mini-Player"
      style={cardStyle}
      className={`relative ${
        fullWindow
          ? 'w-screen h-screen rounded-[22px]'
          : 'w-[468px] max-w-[calc(100vw-24px)] rounded-[20px]'
      } select-none overflow-hidden p-2.5 py-2 flex flex-col justify-between gap-1.5 ${containerClass}`}
    >
      {/* RIRI_GLASS: corner glow layers (coral bottom-left, periwinkle right) */}
      {miniOverlayTheme === 'RIRI_GLASS' && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-10 -left-6 w-48 h-48 rounded-full blur-[50px] opacity-35"
            style={{ backgroundColor: artworkPalette?.primary || '#ED5564' }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 -right-4 w-56 h-40 blur-[50px] opacity-30"
            style={{ backgroundColor: artworkPalette?.secondary || '#707CF5' }}
          />
        </>
      )}
      {isGlassTheme && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 -left-8 w-40 h-40 rounded-full opacity-25 blur-2xl"
            style={{
              backgroundColor: artworkPalette?.primary || themeSeedColor || '#ED5564',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-10 -right-6 w-48 h-40 rounded-full opacity-20 blur-2xl"
            style={{
              backgroundColor: artworkPalette?.secondary || '#3b82f6',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0.05) 100%)',
            }}
          />
        </>
      )}

      {/* Header: Compact Title Bar */}
      <div className="relative z-10 flex items-center justify-between gap-1.5 pb-1 border-b border-white/[0.10]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            style={
              dynamicTheme
                ? {
                    backgroundColor: dynamicTheme.primary,
                    color: dynamicTheme.onPrimary || '#ffffff',
                  }
                : miniOverlayTheme === 'RIRI_GLASS'
                  ? {
                      background: `linear-gradient(135deg, ${artworkPalette?.primary ?? '#ED5564'}, ${artworkPalette?.secondary ?? '#ED2F5B'})`,
                      boxShadow: `0 0 14px rgba(${artworkPalette?.primary ?? '#ED5564'}, 0.55)`,
                      color: '#ffffff',
                    }
                  : undefined
            }
            className={`flex items-center justify-center font-bold shrink-0 shadow-sm ${
              miniOverlayTheme === 'RIRI_GLASS'
                ? 'w-7 h-7 rounded-full text-[10px] tracking-tighter'
                : 'w-5 h-5 rounded-md bg-[var(--md-primary)] text-[var(--md-on-primary)] text-[10px] tracking-tight'
            }`}
          >
            RP
          </span>
          <span className={`text-[11px] font-semibold tracking-tight truncate ${primaryTextClass}`}>
            Riri Mini-Player
          </span>
        </div>

        <div style={noDrag} className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onToggleLock}
            aria-label={isLocked ? 'Unpin mini-player' : 'Pin mini-player'}
            title={isLocked ? 'Unpin position' : 'Pin position'}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              isLocked ? 'text-[var(--md-primary)]' : `${secondaryTextClass} hover:${primaryTextClass}`
            }`}
          >
            {isLocked ? (
              <PinOff className="w-3 h-3" />
            ) : (
              <Pin className="w-3 h-3 -rotate-45" />
            )}
          </button>
          <span
            className={`w-px h-3 bg-white/20 self-stretch ${
              miniOverlayTheme === 'RIRI_GLASS' ? 'bg-white/30' : ''
            }`}
          />
          <button
            type="button"
            onClick={onOpenCinemaView}
            aria-label="Expand mini-player"
            title="Expand"
            className={`p-1 rounded-md transition-colors cursor-pointer ${secondaryTextClass}`}
          >
            <Maximize2 className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onMinimize}
            aria-label="Minimize mini-player"
            title="Minimize"
            className={`p-1 rounded-md transition-colors cursor-pointer ${secondaryTextClass}`}
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Open Riri Player"
            title="Open Riri Player"
            className={`p-1 rounded-md hover:bg-red-500/20 hover:text-red-300 transition-colors cursor-pointer ${secondaryTextClass}`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Middle Row: Artwork + Track Info + Transport Controls */}
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative">
            <img
              src={currentTrack?.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL}
              alt={currentTrack?.title || 'No track'}
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.src = FALLBACK_ARTWORK_DATA_URL;
              }}
              className={`w-16 h-16 rounded-xl object-cover shrink-0 ${
                miniOverlayTheme === 'RIRI_GLASS'
                  ? `shadow-[0_0_28px_rgba(${primaryRgb.r},${primaryRgb.g},${primaryRgb.b},0.55)] ring-1 ring-white/20`
                  : 'bg-black/30 shadow-md ring-1 ring-white/15'
              }`}
            />
            <button
              type="button"
              onClick={onOpenCinemaView}
              aria-label="Expand"
              title="Expand"
              className="absolute -right-1 -bottom-1 p-1 rounded-md bg-black/50 text-white hover:bg-black/70 transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 min-w-0">
              <span className={`font-bold text-[13px] leading-tight truncate ${primaryTextClass}`}>
                {currentTrack?.title || 'No Track Playing'}
              </span>
              <button
                type="button"
                style={noDrag}
                onClick={onToggleLike}
                aria-label={liked ? 'Unlike' : 'Like'}
                className={`p-1 rounded-full shrink-0 cursor-pointer transition-colors ${
                  liked ? 'text-[var(--md-primary)]' : secondaryTextClass
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${liked ? 'fill-current' : ''}`} />
              </button>
            </div>

            {showLyrics ? (
              activeLyricLine ? (
                <div className="text-[10px] leading-tight italic font-medium mt-0.5">
                  <span
                    style={{
                      color:
                        miniOverlayTheme === 'DYNAMIC_ACCENT' ||
                        miniOverlayTheme === 'RIRI_GLASS'
                          ? '#ffffff'
                          : palettePrimary,
                    }}
                  >
                    {activeLyricLine}
                  </span>
                </div>
              ) : (
                <div className="text-[10px] leading-tight italic font-medium mt-0.5 opacity-70">
                  Lyrics unsupported for the song
                </div>
              )
            ) : (
              <div className={`text-[11px] leading-tight mt-0.5 ${secondaryTextClass}`}>
                {currentTrack?.artist || 'Play music to control here'}
              </div>
            )}
          </div>
        </div>

        <div style={noDrag} className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleShuffle}
            aria-label={shuffleEnabled ? 'Disable shuffle' : 'Enable shuffle'}
            title="Shuffle"
            className={`p-1 rounded-md transition-colors cursor-pointer opacity-70 hover:opacity-100 ${
              shuffleEnabled ? 'text-[var(--md-primary)]' : 'text-white'
            }`}
          >
            <Shuffle className="w-4 h-4 stroke-current" />
          </button>

          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous track"
            title="Previous"
            className={`p-1 rounded-md transition-colors cursor-pointer opacity-70 hover:opacity-100 text-white`}
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            onClick={onTogglePlayPause}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
            style={
              miniOverlayTheme === 'RIRI_GLASS'
                ? {
                    background: `linear-gradient(135deg, ${palettePrimary}, ${paletteSecondary})`,
                    boxShadow: `0 0 22px rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.4)`,
                  }
                : playButtonStyle
            }
            className={`rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95 ${
              miniOverlayTheme === 'RIRI_GLASS'
                ? 'w-10 h-10'
                : 'w-8 h-8 bg-[var(--md-primary)] text-[var(--md-on-primary)]'
            }`}
          >
            {isPlaying ? (
              <Pause className={`w-4 h-4 fill-current ${miniOverlayTheme === 'RIRI_GLASS' ? '' : 'ml-0.5'}`} />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onNext}
            aria-label="Next track"
            title="Next"
            className={`p-1 rounded-md transition-colors cursor-pointer opacity-70 hover:opacity-100 text-white`}
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            onClick={onCycleRepeatMode}
            aria-label={`Repeat mode: ${repeatMode}`}
            title={`Repeat: ${repeatMode}`}
            className={`p-1 rounded-md transition-colors cursor-pointer opacity-70 hover:opacity-100 ${
              repeatMode === 'OFF' ? 'text-white' : 'text-[var(--md-primary)]'
            }`}
          >
            {repeatMode === 'ONE' ? (
              <Repeat1 className="w-4 h-4 stroke-current" />
            ) : (
              <Repeat className="w-4 h-4 stroke-current" />
            )}
          </button>
        </div>
      </div>

      {/* Progress / Seek Bar + Compact Timestamps */}
      <div style={noDrag} className="relative z-10 w-full">
        <div className="relative h-1.5 w-full">
          <div
            className="absolute inset-0 h-full rounded-full overflow-hidden pointer-events-none"
            style={{
              backgroundColor:
                miniOverlayTheme === 'RIRI_GLASS' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.16)',
            }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{
                width: `${Math.min(100, Math.max(0, (positionSec / Math.max(1, durationSec))) * 100)}%`,
                backgroundColor: miniOverlayTheme === 'RIRI_GLASS' ? palettePrimary : accentColor,
              }}
            />
          </div>
          <input
            type="range"
            aria-label="Mini-player seek bar"
            min={0}
            max={1}
            step={0.01}
            value={Math.max(0, Math.min(1, positionSec / Math.max(1, durationSec)))}
            onChange={(e) => {
              const next = parseFloat(e.target.value);
              onSeek(next * Math.max(1, durationSec));
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0 z-20"
          />
        </div>
        <div
          className={`flex items-center justify-between text-[10px] leading-none font-medium font-mono-tabular mt-1 ${secondaryTextClass}`}
        >
          <span>{formatTime(positionSec)}</span>
          <span>{formatTime(durationSec)}</span>
        </div>
      </div>

      {/* Bottom Action Row: Volume | Lyrics & Cinema View */}
      <div
        style={noDrag}
        className="relative z-10 flex items-center justify-between gap-2 pt-0.5"
      >
        {/* Left: Volume */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={isMuted || displayVolume === 0 ? 'Unmute' : 'Mute'}
            className={`p-1 rounded-md transition-colors cursor-pointer opacity-70 hover:opacity-100 text-white`}
          >
            {isMuted || displayVolume === 0 ? (
              <VolumeX className="w-3.5 h-3.5 stroke-current" />
            ) : displayVolume < 0.5 ? (
              <Volume1 className="w-3.5 h-3.5 stroke-current" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 stroke-current" />
            )}
          </button>

          <div className="relative w-20 h-1.5 flex items-center group select-none">
            <div
              className={`w-full h-full rounded-full overflow-hidden pointer-events-none ${
                miniOverlayTheme === 'RIRI_GLASS' ? 'riri-range' : 'bg-white/15'
              }`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-75"
                style={{
                  width: `${displayVolume * 100}%`,
                  backgroundColor: miniOverlayTheme === 'RIRI_GLASS' || miniOverlayTheme === 'DYNAMIC_ACCENT' ? palettePrimary : accentColor,
                }}
              />
              <span
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full opacity-0 group-hover:opacity-100 shadow transition-opacity pointer-events-none"
                style={{
                  left: `${displayVolume * 100}%`,
                  backgroundColor:
                    miniOverlayTheme === 'RIRI_GLASS' || miniOverlayTheme === 'DYNAMIC_ACCENT'
                      ? palettePrimary
                      : accentColor,
                  boxShadow:
                    miniOverlayTheme === 'RIRI_GLASS' || miniOverlayTheme === 'DYNAMIC_ACCENT'
                      ? `0 0 10px rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.7)`
                      : undefined,
                }}
              />
            </div>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={displayVolume}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                setIsMuted(next === 0);
                onSetVolume(next);
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0"
            />
          </div>
        </div>

        {/* Vertical divider */}
        <span className="w-px h-4 bg-white/20 self-stretch" />

        {/* Right: Lyrics only */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLyrics((prev) => !prev)}
            aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
              miniOverlayTheme === 'DYNAMIC_ACCENT' || miniOverlayTheme === 'RIRI_GLASS'
                ? showLyrics
                  ? 'text-[var(--md-primary)]'
                  : 'text-white/70'
                : showLyrics
                  ? `text-[${palettePrimary}]`
                  : secondaryTextClass
            }`}
          >
            {showLyrics ? (
              <Mic className={`w-3 h-3 fill-current`} />
            ) : (
              <MicOff className={`w-3 h-3 stroke-current`} />
            )}
          </button>

          <button
            type="button"
            onClick={() => onToggleLyricsLanguage()}
            aria-label={
              lyricsLanguage === 'ENGLISH'
                ? 'Switch to native lyrics'
                : 'Switch to English lyrics'
            }
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
              lyricsLanguage === 'ENGLISH'
                ? miniOverlayTheme === 'DYNAMIC_ACCENT' || miniOverlayTheme === 'RIRI_GLASS'
                  ? 'text-[var(--md-primary)]'
                  : `text-[${palettePrimary}]`
                : secondaryTextClass
            }`}
          >
            {lyricsLanguage === 'ENGLISH' ? 'Native' : 'Eng'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Web unified Mini-Player view
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
    cycleRepeatMode,
    toggleShuffle,
    repeatMode,
    shuffleEnabled,
    volume,
    updateSettings,
    activeTrackLyrics,
    toggleLyricsLanguage,
  } = useRiriPlayer();

  const [isLocked, setIsLocked] = useState(false);

  const parsedLyrics = useMemo(
    () => {
      if (settings.lyricsLanguage === 'ENGLISH' && activeTrackLyrics.englishLyrics) {
        const original = parseLrcLyrics(activeTrackLyrics.syncedLyrics);
        return activeTrackLyrics.englishLyrics.map((text, i) => ({
          text,
          timeMs: original[i]?.timeMs ?? i * 1000,
        }));
      }
      return parseLrcLyrics(activeTrackLyrics.syncedLyrics);
    },
    [
      activeTrackLyrics.syncedLyrics,
      activeTrackLyrics.englishLyrics,
      settings.lyricsLanguage,
    ],
  );
  const activeLyricIdx = useMemo(
    () => findActiveLyricIndex(parsedLyrics, positionSec * 1000, settings.lyricsOffsetMs),
    [parsedLyrics, positionSec, settings.lyricsOffsetMs],
  );
  const activeLyricLine = activeLyricIdx >= 0 ? parsedLyrics[activeLyricIdx]?.text : null;
  const liked = currentTrack ? isTrackLiked(currentTrack.id) : false;

  if (!showMiniOverlay) return null;

  return (
    <div
      className="min-h-screen w-screen flex flex-col items-center justify-center p-4"
      style={{
        background:
          settings.miniOverlayTheme === 'GLASS'
            ? 'radial-gradient(circle at 25% 25%, rgba(237, 85, 100, 0.24), transparent 50%), radial-gradient(circle at 75% 75%, rgba(99, 102, 241, 0.22), transparent 55%), #0c0c10'
            : settings.miniOverlayTheme === 'RIRI_GLASS'
              ? 'radial-gradient(120% 90% at 0% 100%, rgba(237, 85, 100, 0.25), transparent 55%), radial-gradient(80% 90% at 100% 60%, rgba(120, 130, 240, 0.20), transparent 60%), linear-gradient(135deg, rgba(24, 22, 28, 0.85), rgba(16, 14, 20, 0.85))'
              : 'var(--md-background)',
      }}
    >
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
        repeatMode={repeatMode}
        shuffleEnabled={shuffleEnabled}
        volume={volume ?? settings.volume}
        lyricsLanguage={settings.lyricsLanguage}
        isLocked={isLocked}
        onToggleLock={() => setIsLocked((v) => !v)}
        onPrev={() => void prevTrack()}
        onTogglePlayPause={() => void togglePlayPause()}
        onNext={() => void nextTrack()}
        onCycleRepeatMode={() => void cycleRepeatMode()}
        onToggleShuffle={() => void toggleShuffle()}
        onToggleLyricsLanguage={() => void toggleLyricsLanguage()}
        onSeek={seekTo}
        onSetVolume={(v) => void updateSettings({ volume: v })}
        onToggleLike={
          currentTrack ? () => toggleLike(currentTrack.id, currentTrack) : undefined
        }
        onOpenCinemaView={() => closeMiniPlayer(true)}
        onMinimize={() => closeMiniPlayer(false)}
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
    repeatMode?: 'OFF' | 'ALL' | 'ONE';
    shuffleEnabled?: boolean;
    volume?: number;
    liked?: boolean;
    activeLyricLine?: string | null;
    lyricsLanguage?: 'NATIVE' | 'ENGLISH';
  }>({
    currentTrack: null,
    isPlaying: false,
    positionSec: 0,
    durationSec: 0,
    miniOverlayTheme: 'GLASS',
    sliderStyle: 'DEFAULT',
    themeSeedColor: '#ed5564',
    darkMode: 'DARK',
    themeSurfaceStyle: 'GLASS',
    repeatMode: 'OFF',
    shuffleEnabled: false,
    volume: 0.85,
    liked: false,
    activeLyricLine: null,
    lyricsLanguage: 'NATIVE',
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const [isLocked, setIsLocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem('riri_overlay_locked') === 'true';
    } catch {
      return false;
    }
  });

  const [localVolume, setLocalVolume] = useState<number>(() => {
    try {
      const v = localStorage.getItem('riri_overlay_volume');
      return v ? parseFloat(v) : 0.85;
    } catch {
      return 0.85;
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
    ch.onmessage = (
      e: MessageEvent<{
        type?: string;
        payload?: typeof state;
        action?: string;
        positionSec?: number;
        volume?: number;
      }>,
    ) => {
      if (e.data?.type === 'STATE' && e.data.payload) {
        const p = e.data.payload;
        setState((prev) => ({ ...prev, ...p }));
        if (typeof p.volume === 'number') {
          setLocalVolume(p.volume);
        }
        if (p.themeSeedColor) {
          applyMaterialTheme(
            p.themeSeedColor,
            p.darkMode || 'DARK',
            false,
            p.themeSurfaceStyle || 'GLASS',
          );
        }
      } else if (e.data?.type === 'REQUEST_STATE') {
        const current = stateRef.current;
        ch.postMessage({
          type: 'STATE',
          payload: {
            currentTrack: current.currentTrack,
            isPlaying: current.isPlaying,
            positionSec: current.positionSec,
            durationSec: current.durationSec,
            miniOverlayTheme: current.miniOverlayTheme,
            sliderStyle: current.sliderStyle,
            themeSeedColor: current.themeSeedColor,
            darkMode: current.darkMode,
            themeSurfaceStyle: current.themeSurfaceStyle,
          },
        });
      }
    };
    ch.postMessage({ type: 'REQUEST_STATE' });
    return () => ch.close();
  }, []);

  const sendCmd = (
    action: string,
    payload?: { positionSec?: number; volume?: number },
  ) => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('riri_mini_overlay');
    ch.postMessage({ type: 'CMD', action, ...payload });
    ch.close();
  };

  const sendSeek = (positionSec: number) => {
    setState((prev) => ({ ...prev, positionSec }));
    sendCmd('seek', { positionSec });
  };

  const sendVolume = (vol: number) => {
    setLocalVolume(vol);
    try {
      localStorage.setItem('riri_overlay_volume', String(vol));
    } catch {
      // ignore
    }
    sendCmd('volume', { volume: vol });
  };

  const handleMinimize = () => {
    const electronApi = (
      window as unknown as {
        electronAPI?: {
          minimizeOverlayWindow?: () => void;
          restoreFromMiniPlayer?: (openCinema: boolean) => void;
        };
      }
    ).electronAPI;
    if (electronApi?.minimizeOverlayWindow) {
      electronApi.minimizeOverlayWindow();
    } else if (electronApi?.restoreFromMiniPlayer) {
      electronApi.restoreFromMiniPlayer(false);
    }
  };

  const handleReturnToApp = (openCinema: boolean) => {
    if (openCinema) {
      sendCmd('open-cinema');
    }
    const electronApi = (
      window as unknown as {
        electronAPI?: {
          restoreFromMiniPlayer?: (openCinema: boolean) => void;
          closeOverlayWindow?: () => void;
        };
      }
    ).electronAPI;
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
      sliderStyle={state.sliderStyle || 'DEFAULT'}
      themeSeedColor={state.themeSeedColor || '#ed5564'}
      activeLyricLine={state.activeLyricLine}
      liked={state.liked ?? false}
      repeatMode={state.repeatMode ?? 'OFF'}
      shuffleEnabled={state.shuffleEnabled ?? false}
      volume={localVolume}
      lyricsLanguage={state.lyricsLanguage ?? 'NATIVE'}
      isLocked={isLocked}
      onToggleLock={() => setIsLocked((prev) => !prev)}
      onPrev={() => sendCmd('prev')}
      onTogglePlayPause={() => sendCmd('toggle')}
      onNext={() => sendCmd('next')}
      onCycleRepeatMode={() => sendCmd('repeat')}
      onToggleShuffle={() => sendCmd('shuffle')}
      onToggleLyricsLanguage={() => sendCmd('toggleLyricsLanguage')}
      onSeek={sendSeek}
      onSetVolume={sendVolume}
      onToggleLike={() => sendCmd('like')}
      onOpenCinemaView={() => handleReturnToApp(true)}
      onMinimize={handleMinimize}
      onClose={() => handleReturnToApp(false)}
      dragRegion
      fullWindow
    />
  );
};