import React, { useId, useState } from 'react';
import { SliderStyle } from '../types/music';
import { formatTime } from '../utils/lyricsParser';

interface SeekBarSliderProps {
  sliderStyle: SliderStyle;
  positionSec: number;
  durationSec: number;
  isPlaying?: boolean;
  onSeek: (sec: number) => void;
  ariaLabel?: string;
  step?: number;
  showHoverTime?: boolean;
  accentColor?: string;
  trackBgColor?: string;
  className?: string;
}

export const SeekBarSlider: React.FC<SeekBarSliderProps> = ({
  sliderStyle,
  positionSec,
  durationSec,
  isPlaying = false,
  onSeek,
  ariaLabel = 'Track progress',
  step = 0.25,
  showHoverTime = false,
  accentColor = 'var(--md-primary)',
  trackBgColor = 'var(--md-surface-container-highest)',
  className = '',
}) => {
  const [hoverPct, setHoverPct] = useState(0);
  const [hoverSec, setHoverSec] = useState<number | null>(null);
  const patternId = useId().replace(/:/g, '');

  const safeMax = Math.max(1, durationSec || 0);
  const clampedPos = Math.min(Math.max(0, positionSec || 0), safeMax);
  const pct = durationSec > 0 ? Math.min(100, Math.max(0, (clampedPos / durationSec) * 100)) : 0;

  return (
    <div
      data-slider-style={sliderStyle}
      className={`relative flex items-center select-none group ${
        sliderStyle === 'WAVY' ? 'h-5' : sliderStyle === 'SLIM' ? 'h-3.5' : 'h-4'
      } ${className}`}
      onMouseMove={(e) => {
        if (!showHoverTime) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setHoverPct(ratio * 100);
        setHoverSec(ratio * (durationSec || 0));
      }}
      onMouseLeave={() => {
        if (showHoverTime) setHoverSec(null);
      }}
    >
      {showHoverTime && hoverSec !== null && durationSec > 0 && (
        <div
          style={{ left: `${hoverPct}%` }}
          className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[var(--md-surface-container-highest)] text-[10px] font-semibold text-[var(--md-on-surface)] shadow pointer-events-none z-30"
        >
          {formatTime(hoverSec)}
        </div>
      )}

      {/* Visual track */}
      {sliderStyle === 'WAVY' ? (
        <div className="relative w-full h-4 flex items-center pointer-events-none">
          {/* Unplayed flat segment */}
          <div
            className="absolute right-0 h-[3px] rounded-full"
            style={{
              left: `${pct}%`,
              backgroundColor: trackBgColor,
            }}
          />

          {/* Played wavy segment */}
          <div
            className="absolute left-0 top-0 bottom-0 overflow-hidden"
            style={{ width: `${pct}%` }}
          >
            {isPlaying ? (
              <svg
                className="h-full w-[calc(100%+24px)] animate-riri-wave"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <pattern
                    id={`wave-${patternId}`}
                    width="24"
                    height="16"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 0 8 Q 6 2, 12 8 T 24 8"
                      fill="none"
                      stroke={accentColor}
                      strokeWidth="2.8"
                      strokeLinecap="round"
                    />
                  </pattern>
                </defs>
                <rect width="100%" height="16" fill={`url(#wave-${patternId})`} />
              </svg>
            ) : (
              <div
                className="w-full h-[3px] rounded-full mt-[6.5px]"
                style={{ backgroundColor: accentColor }}
              />
            )}
          </div>

          {/* Expressive pill thumb */}
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-3.5 rounded-full shadow-sm transition-transform group-hover:scale-125"
            style={{
              left: `${pct}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>
      ) : sliderStyle === 'SLIM' ? (
        <div className="relative w-full flex items-center pointer-events-none">
          <div
            className="w-full h-[2px] group-hover:h-[3px] rounded-full overflow-hidden transition-[height]"
            style={{ backgroundColor: trackBgColor }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                backgroundColor: accentColor,
              }}
            />
          </div>
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full opacity-80 group-hover:opacity-100 group-hover:scale-125 shadow-sm transition-all"
            style={{
              left: `${pct}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>
      ) : (
        /* DEFAULT: Bold Standard Material 3 Bar */
        <div className="relative w-full flex items-center pointer-events-none">
          <div
            className="w-full h-1.5 rounded-full overflow-hidden"
            style={{ backgroundColor: trackBgColor }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                backgroundColor: accentColor,
              }}
            />
          </div>
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full shadow transition-transform group-hover:scale-110"
            style={{
              left: `${pct}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>
      )}

      {/* Accessible native range input overlay */}
      <input
        type="range"
        aria-label={ariaLabel}
        min={0}
        max={safeMax}
        step={step}
        value={clampedPos}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 m-0"
      />
    </div>
  );
};
