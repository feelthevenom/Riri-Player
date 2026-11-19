import React, { useEffect, useRef, useState } from 'react';
import {
  Database,
  Download,
  Folder,
  FolderOpen,
  HardDrive,
  Languages,
  Loader2,
  LogIn,
  LogOut,
  Minimize2,
  Monitor,
  Palette,
  Pin,
  PictureInPicture2,
  
  RotateCcw,
  Shield,
  Sliders,
  Trash2,
  Upload,
  UserCircle2,
} from 'lucide-react';
import { useArchiveTune } from '../context/ArchiveTuneContext';
import { THEME_PRESETS, YTM_LANGUAGES, YTM_REGIONS, OVERLAY_THEME_CLASSES } from '../data/catalog';
import { TRANSLATOR_LANGUAGES } from '../data/translatorLanguages';
import {
  DarkModePreference,
  MiniOverlayPin,
  MiniOverlayTheme,
  PlayerBackgroundStyle,
  SliderStyle,
  ThemeSurfaceStyle,
} from '../types/music';

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
    setShowEqModal,
    showMiniOverlay,
    setShowMiniOverlay,
    activeYtAccount,
    signOutGoogleAccount,
    signInYtMusicAccount,
    exportBackupJson,
    importBackupJson,
    showToast,
    navigate,
    
  } = useArchiveTune();

  const [ytMusicSignInLoading, setYtMusicSignInLoading] = useState(false);

  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const backupFileRef = useRef<HTMLInputElement | null>(null);

  const [cacheSizeBytes, setCacheSizeBytes] = useState<number>(0);
  const [clearingCache, setClearingCache] = useState<boolean>(false);
  const [defaultStoragePath, setDefaultStoragePath] = useState<string>('');

  useEffect(() => {
    const api = (window as unknown as {
      electronAPI?: {
        getCacheSize?: () => Promise<{ ok: boolean; sizeBytes?: number }>;
        getDefaultStoragePath?: () => Promise<string>;
      };
    }).electronAPI;

    if (api?.getCacheSize) {
      api
        .getCacheSize()
        .then((res) => {
          if (res.ok && typeof res.sizeBytes === 'number') {
            setCacheSizeBytes(res.sizeBytes);
          }
        })
        .catch(() => {});
    } else if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      navigator.storage
        .estimate()
        .then((est) => {
          if (est.usage) setCacheSizeBytes(est.usage);
        })
        .catch(() => {});
    }

    if (api?.getDefaultStoragePath) {
      api
        .getDefaultStoragePath()
        .then((p) => {
          if (p) setDefaultStoragePath(p);
        })
        .catch(() => {});
    }
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const api = (window as unknown as {
        electronAPI?: {
          clearCache?: () => Promise<{ ok: boolean }>;
        };
      }).electronAPI;

      if (api?.clearCache) {
        await api.clearCache();
      }
      if (typeof window !== 'undefined' && 'caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      }
      setCacheSizeBytes(0);
      showToast('Cache successfully cleared');
    } catch {
      showToast('Cache cleared');
    } finally {
      setClearingCache(false);
    }
  };

  const handleChangeStoragePath = async () => {
    const api = (window as unknown as {
      electronAPI?: {
        selectDirectory?: () => Promise<{ ok: boolean; path?: string }>;
      };
    }).electronAPI;

    if (api?.selectDirectory) {
      const res = await api.selectDirectory();
      if (res.ok && res.path) {
        updateSettings({ offlineStoragePath: res.path });
        showToast(`Offline storage location set to: ${res.path}`);
      }
    } else {
      showToast('Folder selection is available in the Windows desktop app.');
    }
  };

  const handleResetStoragePath = () => {
    updateSettings({ offlineStoragePath: '' });
    showToast('Reset offline storage to default location.');
  };

  const effectiveStoragePath =
    settings.offlineStoragePath || defaultStoragePath || 'Default (Installation Directory / AppData)';

  const handleExport = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `archivetune-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported ArchiveTune JSON backup');
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
          Glass &amp; Material theme studio, Google Account &amp; YouTube Music, Mini-Player Overlay, Web Audio DSP, and offline storage
        </p>
      </div>

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
          <div className="text-xs font-semibold text-[var(--md-on-surface-variant)]">Surface Material</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {(
              [
                { id: 'MATERIAL', label: 'Material Solid' },
                { id: 'GLASS', label: 'Glass Frosted' },
                { id: 'PURE_BLACK', label: 'Pure Black OLED' },
                { id: 'DESKTOP_FLOATING', label: 'Windows Desktop Floating' },
              ] as Array<{ id: ThemeSurfaceStyle | 'DESKTOP_FLOATING'; label: string }>
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (s.id === 'DESKTOP_FLOATING') {
                    const api = (window as unknown as { electronAPI?: { toggleOverlayWindow?: () => void } }).electronAPI;
                    if (api?.toggleOverlayWindow) {
                      api.toggleOverlayWindow();
                    } else {
                      showToast('Standalone desktop overlay is available in the desktop app.');
                    }
                  } else {
                    updateSettings({
                      themeSurfaceStyle: s.id as ThemeSurfaceStyle,
                      pureBlack: s.id === 'PURE_BLACK',
                    });
                  }
                }}
                className={`py-2.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  s.id === 'DESKTOP_FLOATING'
                    ? 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
                    : settings.themeSurfaceStyle === s.id
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
              <option value="WAVY">ArchiveTune Wavy</option>
              <option value="DEFAULT">Standard</option>
              <option value="SLIM">Slim Desktop</option>
            </select>
          </div>
        </div>
      </section>

      {/* Pinned Windows Mini-Player Overlay & Desktop Integration */}
      <section className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-4">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Monitor className="w-4 h-4 text-[var(--md-primary)]" />
          <span>Mini-Player Overlay & Desktop Integration</span>
        </h2>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          Configure the pinned mini-player overlay theme, position, and the floating Windows desktop overlay that stays on top of all windows.
        </p>

        <div className="space-y-4">
          {/* Overlay Theme */}
          <div>
            <label htmlFor="mini-overlay-theme" className="block text-xs font-semibold mb-1.5">
              Overlay Theme
            </label>
            <select
              id="mini-overlay-theme"
              value={settings.miniOverlayTheme}
              onChange={(e) => updateSettings({ miniOverlayTheme: e.target.value as MiniOverlayTheme })}
              className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
            >
              {(Object.keys(OVERLAY_THEME_CLASSES) as MiniOverlayTheme[]).map((t) => (
                <option key={t} value={t} className="bg-zinc-900 text-white">
                  {OVERLAY_THEME_CLASSES[t].label}
                </option>
              ))}
            </select>
          </div>

          {/* Minimize to Tray */}
          <ToggleSwitch
            checked={settings.minimizeToTray}
            onChange={(checked) => updateSettings({ minimizeToTray: checked })}
            icon={<Minimize2 className="w-4 h-4" />}
            label="Minimize to System Tray"
            description="When closing the main window, minimize to tray instead of closing the app"
          />

          {/* Windows Desktop Floating Overlay */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--md-surface-container)] border border-[var(--md-outline-variant)]/40">
            <div className="flex items-center gap-2.5 min-w-0 pr-3">
              <span className="text-[var(--md-primary)] shrink-0">
                <PictureInPicture2 className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold leading-tight">Windows Desktop Floating Overlay</div>
                <div className="text-[11px] text-[var(--md-on-surface-variant)] mt-0.5 leading-snug">
                  Open a standalone always-on-top mini-player window that floats over all applications
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const api = (window as unknown as { electronAPI?: { toggleOverlayWindow?: () => void } }).electronAPI;
                if (api?.toggleOverlayWindow) {
                  api.toggleOverlayWindow();
                } else {
                  showToast('Standalone desktop overlay is available in the desktop app.');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer hover:opacity-90"
            >
              <span>Toggle Overlay</span>
            </button>
          </div>
        </div>
      </section>

      {/* Backup & Restore */}
      <section className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-4">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Database className="w-4 h-4 text-[var(--md-primary)]" />
          <span>Backup &amp; Restore Library</span>
        </h2>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          Export your playlists, liked tracks, YouTube Music accounts, .arch plugins, EQ profiles,
          listening stats, and desktop preferences to a portable JSON file.
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
