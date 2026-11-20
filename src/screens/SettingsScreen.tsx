import React, { useRef, useState } from 'react';
import {
  Database,
  Disc3,
  Download,
  Loader2,
  LogIn,
  LogOut,
  Minimize2,
  Monitor,
  Palette,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { OVERLAY_THEME_CLASSES, THEME_PRESETS } from '../data/catalog';
import {
  DarkModePreference,
  MiniOverlayTheme,
  PlayerBackgroundStyle,
  SliderStyle,
  SpotifySyncSchedule,
  ThemeSurfaceStyle,
} from '../types/music';
import { formatSpotifyScheduleLabel } from '../utils/spotifySyncHelpers';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
}) => {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      className={`flex items-center justify-between p-3.5 rounded-xl bg-[var(--md-surface-container)] cursor-pointer transition-all duration-200 select-none hover:bg-[var(--md-surface-container-high)] ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0 pr-3">
        {icon && <span className="text-[var(--md-primary)] shrink-0">{icon}</span>}
        <div className="min-w-0">
          {label && <div className="text-xs font-semibold leading-tight">{label}</div>}
          {description && (
            <div className="text-[11px] text-[var(--md-on-surface-variant)] mt-0.5 leading-snug">
              {description}
            </div>
          )}
        </div>
      </div>
      <div
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out cursor-pointer ${
          checked
            ? 'bg-[var(--md-primary)]'
            : 'bg-[var(--md-surface-container-highest)] border border-[var(--md-outline-variant)]/50'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full shadow-md transition-transform duration-200 ease-in-out ${
            checked
              ? 'translate-x-6 bg-[var(--md-on-primary)]'
              : 'translate-x-1 bg-[var(--md-on-surface-variant)]'
          }`}
        />
      </div>
    </div>
  );
};

export const SettingsScreen: React.FC = () => {
  const {
    settings,
    updateSettings,
    spotifyConnection,
    spotifySyncing,
    connectSpotifyAccount,
    disconnectSpotifyAccount,
    syncSpotifyLibrary,
    updateSpotifySchedule,
    exportBackupJson,
    importBackupJson,
    showToast,
  } = useRiriPlayer();

  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [spotifyConnecting, setSpotifyConnecting] = useState(false);
  const backupFileRef = useRef<HTMLInputElement | null>(null);

  const handleSpotifyConnect = async () => {
    setSpotifyConnecting(true);
    try {
      await connectSpotifyAccount();
    } finally {
      setSpotifyConnecting(false);
    }
  };

  const handleExport = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `riri-player-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported Riri Player JSON backup');
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const res = importBackupJson(text);
    setRestoreMsg(res.message);
  };

  return (
    <div className="space-y-8 pb-10 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          Glass &amp; Material theme studio, Spotify Library Sync, Mini-Player preferences, and library backups
        </p>
      </div>

      {/* Automatic Spotify Library & Liked Songs Sync */}
      <section
        aria-label="Spotify Library Sync"
        className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Disc3 className="w-4 h-4 text-[#1DB954]" />
              <span>Spotify Library Sync</span>
            </h2>
            <p className="text-xs text-[var(--md-on-surface-variant)] mt-0.5">
              Sign in with Spotify to sync your playlists and Liked Songs into Riri Player. Not used as app login.
            </p>
          </div>
          {spotifyConnection && (
            <button
              type="button"
              onClick={disconnectSpotifyAccount}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          )}
        </div>

        {spotifyConnection ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[var(--md-surface-container)] border border-[var(--md-outline-variant)]/40">
              <div className="flex items-center gap-3 min-w-0">
                {spotifyConnection.avatarUrl ? (
                  <img
                    src={spotifyConnection.avatarUrl}
                    alt={spotifyConnection.displayName}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center font-bold text-sm shrink-0">
                    {spotifyConnection.displayName.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate flex items-center gap-2">
                    <span className="truncate">{spotifyConnection.displayName}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#1DB954]/15 text-[#1DB954] shrink-0">
                      {spotifyConnection.authMode === 'desktop_web'
                        ? 'Spotify Desktop Session'
                        : 'Spotify Account'}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                    {spotifyConnection.email ||
                      spotifyConnection.profileUrl ||
                      'Connected via Spotify'}
                    {spotifyConnection.lastSyncedAt
                      ? ` · Last synced ${new Date(spotifyConnection.lastSyncedAt).toLocaleString()}`
                      : ' · Ready to sync'}
                  </div>
                  {typeof spotifyConnection.lastSyncedCount === 'number' && (
                    <div className="text-[11px] text-[#1DB954] font-medium">
                      {spotifyConnection.lastSyncedCount} track(s) synced (
                      {formatSpotifyScheduleLabel(spotifyConnection.syncSchedule)})
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={spotifySyncing}
                onClick={() => void syncSpotifyLibrary(false)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1DB954] text-black text-xs font-bold hover:opacity-90 disabled:opacity-60 cursor-pointer shrink-0"
              >
                {spotifySyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>{spotifySyncing ? 'Syncing Library...' : 'Sync Library Now'}</span>
              </button>
            </div>

            {spotifyConnection.lastError && (
              <div className="rounded-xl px-3.5 py-2.5 text-xs bg-red-500/15 text-red-300 border border-red-500/30">
                {spotifyConnection.lastError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label htmlFor="spotify-sync-schedule" className="block text-xs font-semibold mb-1.5">
                  Automatic Sync Schedule
                </label>
                <select
                  id="spotify-sync-schedule"
                  value={spotifyConnection.syncSchedule}
                  onChange={(e) =>
                    updateSpotifySchedule(e.target.value as SpotifySyncSchedule)
                  }
                  className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
                >
                  <option value="MANUAL">Manual Only</option>
                  <option value="DAILY">Every Day</option>
                  <option value="WEEKLY">Every Week</option>
                  <option value="YEARLY">Every Year</option>
                </select>
              </div>
              <div className="text-[11px] text-[var(--md-on-surface-variant)] pb-2">
                When scheduled, Riri Player automatically refreshes your Spotify Liked Songs and Playlists whenever the interval elapses.
              </div>
            </div>
          </div>
        ) : (
          <div>
            <button
              type="button"
              disabled={spotifyConnecting}
              onClick={() => void handleSpotifyConnect()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1DB954] text-black text-xs font-bold hover:opacity-90 disabled:opacity-60 cursor-pointer"
            >
              {spotifyConnecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              <span>
                {spotifyConnecting
                  ? 'Connecting to Spotify...'
                  : 'Sign in with Spotify to Link Library'}
              </span>
            </button>
          </div>
        )}
      </section>

      {/* Appearance & Theme Studio */}
      <section className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-5">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Palette className="w-4 h-4 text-[var(--md-primary)]" />
          <span>Appearance &amp; Theme Studio</span>
        </h2>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">Color Mode</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['DARK', 'LIGHT', 'SYSTEM'] as DarkModePreference[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => updateSettings({ darkMode: mode })}
                className={`py-2.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  settings.darkMode === mode
                    ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                    : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
                }`}
              >
                {mode === 'DARK' ? 'Dark Mode' : mode === 'LIGHT' ? 'Light Mode' : 'Follow System'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
            Surface Material
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(
              [
                { id: 'MATERIAL', label: 'Material Solid' },
                { id: 'GLASS', label: 'Glass Frosted' },
                { id: 'PURE_BLACK', label: 'Pure Black OLED' },
              ] as Array<{ id: ThemeSurfaceStyle; label: string }>
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  updateSettings({
                    themeSurfaceStyle: s.id,
                    pureBlack: s.id === 'PURE_BLACK',
                  })
                }
                className={`py-2.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  settings.themeSurfaceStyle === s.id
                    ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                    : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">
            Accent Seed Color
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => updateSettings({ themeColor: preset.primary })}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                  settings.themeColor.toLowerCase() === preset.primary.toLowerCase()
                    ? 'border-[var(--md-primary)] bg-[var(--md-primary-container)]/40'
                    : 'border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)]'
                }`}
              >
                <span
                  style={{ backgroundColor: preset.primary }}
                  className="w-3.5 h-3.5 rounded-full"
                />
                <span>{preset.name}</span>
              </button>
            ))}

            <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] cursor-pointer">
              <input
                type="color"
                aria-label="Custom theme accent color"
                value={settings.themeColor}
                onChange={(e) => updateSettings({ themeColor: e.target.value })}
                className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
              />
              <span className="font-mono-tabular uppercase">{settings.themeColor}</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ToggleSwitch
            checked={settings.pureBlack}
            onChange={(checked) =>
              updateSettings({
                pureBlack: checked,
                themeSurfaceStyle: checked ? 'PURE_BLACK' : 'MATERIAL',
              })
            }
            label="Pure Black AMOLED Surface"
            description="True deep black background for OLED and AMOLED screens"
          />
          <ToggleSwitch
            checked={settings.dynamicThemeFromArtwork}
            onChange={(checked) => updateSettings({ dynamicThemeFromArtwork: checked })}
            label="Dynamic Palette From Album Art"
            description="Dynamically tints the UI based on colors in the playing artwork"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="player-bg-style" className="block text-xs font-semibold mb-1.5">
              Cinema Player Background
            </label>
            <select
              id="player-bg-style"
              value={settings.playerBackgroundStyle}
              onChange={(e) =>
                updateSettings({ playerBackgroundStyle: e.target.value as PlayerBackgroundStyle })
              }
              className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
            >
              <option value="GRADIENT">Dynamic Gradient</option>
              <option value="GLOW">Radial Glow</option>
              <option value="BLUR">Blurred Artwork</option>
              <option value="SOLID">Clean Solid</option>
            </select>
          </div>
          <div>
            <label htmlFor="slider-style" className="block text-xs font-semibold mb-1.5">
              Seek Bar Style
            </label>
            <select
              id="slider-style"
              value={settings.sliderStyle}
              onChange={(e) => updateSettings({ sliderStyle: e.target.value as SliderStyle })}
              className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
            >
              <option value="WAVY">Riri Wavy</option>
              <option value="DEFAULT">Standard</option>
              <option value="SLIM">Slim Desktop</option>
            </select>
          </div>
        </div>
      </section>

      {/* Mini-Player & Desktop Behavior */}
      <section className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-4">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Monitor className="w-4 h-4 text-[var(--md-primary)]" />
          <span>Mini-Player &amp; Desktop Behavior</span>
        </h2>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          Customize the unified Mini-Player theme and desktop close behavior. Switching to Mini-Player hides the main window and lets you jump back anytime via Close or Cinema View.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="mini-overlay-theme" className="block text-xs font-semibold mb-1.5">
              Mini-Player Theme
            </label>
            <select
              id="mini-overlay-theme"
              value={settings.miniOverlayTheme}
              onChange={(e) =>
                updateSettings({ miniOverlayTheme: e.target.value as MiniOverlayTheme })
              }
              className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
            >
              {(Object.keys(OVERLAY_THEME_CLASSES) as MiniOverlayTheme[]).map((t) => (
                <option key={t} value={t} className="bg-zinc-900 text-white">
                  {OVERLAY_THEME_CLASSES[t].label}
                </option>
              ))}
            </select>
          </div>

          <ToggleSwitch
            checked={settings.minimizeToTray}
            onChange={(checked) => updateSettings({ minimizeToTray: checked })}
            icon={<Minimize2 className="w-4 h-4" />}
            label="Minimize to System Tray"
            description="When closing the main window, minimize to tray instead of exiting the app"
          />
        </div>
      </section>

      {/* Backup & Restore */}
      <section className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-4">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Database className="w-4 h-4 text-[var(--md-primary)]" />
          <span>Backup &amp; Restore Library</span>
        </h2>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          Export your playlists, liked tracks, linked accounts, .arch plugins, EQ profiles, listening stats, and desktop preferences to a portable JSON file.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export JSON Backup</span>
          </button>

          <input
            ref={backupFileRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => backupFileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] text-xs font-semibold cursor-pointer"
          >
            <Upload className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Restore From JSON</span>
          </button>
        </div>

        {restoreMsg && (
          <div className="text-xs font-semibold text-[var(--md-primary)]">{restoreMsg}</div>
        )}
      </section>
    </div>
  );
};
