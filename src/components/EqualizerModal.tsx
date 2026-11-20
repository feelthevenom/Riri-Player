import React from 'react';
import { RotateCcw, Sliders, X } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { EQ_CENTER_FREQS } from '../data/catalog';

function formatFreq(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}kHz` : `${hz}Hz`;
}

export const EqualizerModal: React.FC = () => {
  const {
    showEqModal,
    setShowEqModal,
    eqProfiles,
    activeEqId,
    activeEq,
    selectEqProfile,
    updateEqBand,
    updateEqParams,
    settings,
    updateSettings,
  } = useRiriPlayer();

  if (!showEqModal) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="10-Band Equalizer and DSP Effects"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="at-glass-card w-full max-w-3xl rounded-2xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-[var(--md-primary)]" />
            <div>
              <h2 className="text-lg font-bold">10-Band Audio Equalizer &amp; DSP</h2>
              <p className="text-xs text-[var(--md-on-surface-variant)]">
                Real-time Web Audio API BiquadFilterNode chain (32Hz – 16kHz)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={activeEq.enabled}
                onChange={(e) => updateEqParams({ enabled: e.target.checked })}
                className="accent-[var(--md-primary)] w-4 h-4"
              />
              <span>Enable EQ</span>
            </label>
            <button
              type="button"
              onClick={() => setShowEqModal(false)}
              aria-label="Close equalizer"
              className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] hover:bg-[var(--md-surface-container-high)] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Preset Selector */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {eqProfiles.map((prof) => (
            <button
              key={prof.id}
              type="button"
              onClick={() => selectEqProfile(prof.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                prof.id === activeEqId
                  ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                  : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)]'
              }`}
            >
              {prof.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              updateEqParams({
                bandLevelsDb: new Array(EQ_CENTER_FREQS.length).fill(0),
                outputGainDb: 0,
                bassBoostDb: 0,
              })
            }
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Bands
          </button>
        </div>

        {/* 10-Band EQ Sliders */}
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-3 rounded-2xl bg-[var(--md-surface-container-low)] p-4 border border-[var(--md-outline-variant)]/40 mb-6">
          {EQ_CENTER_FREQS.map((freq, idx) => {
            const db = activeEq.bandLevelsDb[idx] ?? 0;
            return (
              <div key={freq} className="flex flex-col items-center gap-2">
                <span className="text-[11px] font-semibold font-mono-tabular text-[var(--md-primary)]">
                  {db > 0 ? `+${db.toFixed(1)}` : db.toFixed(1)} dB
                </span>
                <div className="h-32 flex items-center justify-center">
                  <input
                    type="range"
                    aria-label={`${formatFreq(freq)} gain`}
                    min={-12}
                    max={12}
                    step={0.5}
                    value={db}
                    onChange={(e) => updateEqBand(idx, parseFloat(e.target.value))}
                    className="w-28 -rotate-90 accent-[var(--md-primary)] cursor-pointer"
                  />
                </div>
                <span className="text-[11px] font-medium text-[var(--md-on-surface-variant)]">
                  {formatFreq(freq)}
                </span>
              </div>
            );
          })}
        </div>

        {/* DSP Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl bg-[var(--md-surface-container-low)] p-4 border border-[var(--md-outline-variant)]/30">
            <div className="flex justify-between text-xs font-semibold mb-2">
              <span>Preamp Gain</span>
              <span className="font-mono-tabular text-[var(--md-primary)]">
                {activeEq.outputGainDb > 0 ? `+${activeEq.outputGainDb}` : activeEq.outputGainDb} dB
              </span>
            </div>
            <input
              type="range"
              aria-label="Preamp Gain"
              min={-12}
              max={12}
              step={0.5}
              value={activeEq.outputGainDb}
              onChange={(e) => updateEqParams({ outputGainDb: parseFloat(e.target.value) })}
              className="w-full accent-[var(--md-primary)] cursor-pointer"
            />
          </div>

          <div className="rounded-xl bg-[var(--md-surface-container-low)] p-4 border border-[var(--md-outline-variant)]/30">
            <div className="flex justify-between text-xs font-semibold mb-2">
              <span>Low-Shelf Bass Boost (85Hz)</span>
              <span className="font-mono-tabular text-[var(--md-primary)]">
                +{activeEq.bassBoostDb.toFixed(1)} dB
              </span>
            </div>
            <input
              type="range"
              aria-label="Bass Boost"
              min={0}
              max={10}
              step={0.5}
              value={activeEq.bassBoostDb}
              onChange={(e) => updateEqParams({ bassBoostDb: parseFloat(e.target.value) })}
              className="w-full accent-[var(--md-primary)] cursor-pointer"
            />
          </div>

          <div className="rounded-xl bg-[var(--md-surface-container-low)] p-4 border border-[var(--md-outline-variant)]/30">
            <div className="flex justify-between text-xs font-semibold mb-2">
              <span>Playback Speed / Tempo</span>
              <span className="font-mono-tabular text-[var(--md-primary)]">
                {settings.playbackSpeed.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              aria-label="Playback Speed"
              min={0.5}
              max={2.0}
              step={0.05}
              value={settings.playbackSpeed}
              onChange={(e) => updateSettings({ playbackSpeed: parseFloat(e.target.value) })}
              className="w-full accent-[var(--md-primary)] cursor-pointer"
            />
          </div>

          <div className="rounded-xl bg-[var(--md-surface-container-low)] p-4 border border-[var(--md-outline-variant)]/30">
            <div className="flex justify-between text-xs font-semibold mb-2">
              <span>Track Crossfade Ramp</span>
              <span className="font-mono-tabular text-[var(--md-primary)]">
                {settings.crossfadeSec}s
              </span>
            </div>
            <input
              type="range"
              aria-label="Crossfade Duration"
              min={0}
              max={12}
              step={1}
              value={settings.crossfadeSec}
              onChange={(e) => updateSettings({ crossfadeSec: parseInt(e.target.value, 10) })}
              className="w-full accent-[var(--md-primary)] cursor-pointer"
            />
          </div>

          <label className="flex items-center justify-between rounded-xl bg-[var(--md-surface-container-low)] p-4 border border-[var(--md-outline-variant)]/30 text-xs font-semibold cursor-pointer">
            <div>
              <div>Preserve Vocal Pitch</div>
              <div className="text-[11px] font-normal text-[var(--md-on-surface-variant)]">
                Keep natural pitch when changing speed
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.preservePitch}
              onChange={(e) => updateSettings({ preservePitch: e.target.checked })}
              className="accent-[var(--md-primary)] w-4 h-4"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl bg-[var(--md-surface-container-low)] p-4 border border-[var(--md-outline-variant)]/30 text-xs font-semibold cursor-pointer">
            <div>
              <div>Loudness Normalization</div>
              <div className="text-[11px] font-normal text-[var(--md-on-surface-variant)]">
                Real-time DynamicsCompressor leveling
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.normalizeLoudness}
              onChange={(e) => updateSettings({ normalizeLoudness: e.target.checked })}
              className="accent-[var(--md-primary)] w-4 h-4"
            />
          </label>
        </div>
      </div>
    </div>
  );
};
