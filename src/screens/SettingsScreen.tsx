import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Database,
  Disc3,
  Download,
  Globe,
  Languages,
  Loader2,
  LogIn,
  LogOut,
  Mic,
  Minimize2,
  Monitor,
  Palette,
  RefreshCw,
  RotateCcw,
  Search,
  Sliders,
  Upload,
  Trash2,
  X,
  Youtube,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import {
  LYRICS_PROVIDERS_CATALOG,
  OVERLAY_THEME_CLASSES,
  THEME_PRESETS,
  YTM_LANGUAGES,
  YTM_REGIONS,
} from '../data/catalog';
import {
  AppSettings,
  DarkModePreference,
  LyricsProviderId,
  MiniOverlayTheme,
  PlayerBackgroundStyle,
  SliderStyle,
  SpotifySyncProgress,
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
    activeYtAccount,
    ytAccounts,
    signingInYtMusic,
    ytAccountMutationPending,
    ytLoginError,
    ytLoginRetryable,
    ytLoginBlocked,
    clearYtLoginError,
    retryYtMusicSignIn,
    resetYtVault,
    ytVaultDiagnostic,
    signInWithYouTubeMusic,
    switchYtAccount,
    signOutYtAccount,
    syncYtMusicLibrary,
    librarySyncProgress,
    lastLibrarySyncAt,
    spotifyConnection,
    spotifySyncing,
    spotifySyncProgress,
    spotifyUnmatchedTracks,
    connectSpotifyAccount,
    disconnectSpotifyAccount,
    syncSpotifyLibrary,
    updateSpotifySchedule,
    dismissSpotifyUnmatched,
    setGlobalSearchQuery,
    navigate,
    exportBackupJson,
    importBackupJson,
    resetAllUserData,
    showToast,
  } = useRiriPlayer();

  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [resettingYtVault, setResettingYtVault] = useState(false);
  const [resettingAllData, setResettingAllData] = useState(false);
  const [spotifyConnecting, setSpotifyConnecting] = useState(false);
  const [ytSyncing, setYtSyncing] = useState(false);
  const backupFileRef = useRef<HTMLInputElement | null>(null);

  const validLyricsProviderIds = React.useMemo(
    () => new Set(LYRICS_PROVIDERS_CATALOG.map((provider) => provider.id)),
    [],
  );
  const currentProviders: LyricsProviderId[] = React.useMemo(() => {
    const stored = Array.isArray(settings.lyricsProviders)
      ? settings.lyricsProviders
      : [];
    const normalized = Array.from(
      new Set(stored.filter((provider) => validLyricsProviderIds.has(provider))),
    );
    return normalized.length > 0 ? normalized : ['lrclib'];
  }, [settings.lyricsProviders, validLyricsProviderIds]);

  React.useEffect(() => {
    if (
      Array.isArray(settings.lyricsProviders) &&
      settings.lyricsProviders.length === currentProviders.length &&
      settings.lyricsProviders.every((provider, index) => provider === currentProviders[index])
    ) {
      return;
    }
    updateSettings({ lyricsProviders: currentProviders });
  }, [currentProviders, settings.lyricsProviders, updateSettings]);

  const toggleLyricsProvider = (id: LyricsProviderId) => {
    let next: LyricsProviderId[];
    if (currentProviders.includes(id)) {
      if (currentProviders.length <= 1) {
        showToast('At least one lyrics provider must remain active.');
        return;
      }
      next = currentProviders.filter((p) => p !== id);
    } else {
      next = [...currentProviders, id];
    }
    updateSettings({ lyricsProviders: next });
  };

  const moveLyricsProvider = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentProviders.length) return;
    const reordered = [...currentProviders];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    updateSettings({ lyricsProviders: reordered });
  };

  // Update state
  const [updateStatus, setUpdateStatus] = useState<{
    status: string;
    info?: any;
    error?: string;
    currentVersion?: string;
    latestVersion?: string;
    metadataMissing?: boolean;
    releaseUrl?: string;
  } | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ percent: number; bytesPerSecond: number; total: number; transferred: number } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(false);
  const [checkOnStartupEnabled, setCheckOnStartupEnabled] = useState(true);

  const handleYtmSignIn = async (cleanPartition = false) => {
    clearYtLoginError();
    await signInWithYouTubeMusic(cleanPartition ? { cleanPartition: true } : undefined);
  };

  const handleResetYtVault = async () => {
    if (
      !window.confirm(
        'Reset the encrypted session vault (including YouTube Music and Spotify credentials)? The unreadable vault will be preserved as a backup file in the Riri Player data folder.',
      )
    ) {
      return;
    }
    setResettingYtVault(true);
    try {
      await resetYtVault();
    } finally {
      setResettingYtVault(false);
    }
  };

  const handleYtmSync = async () => {
    setYtSyncing(true);
    await syncYtMusicLibrary();
    setYtSyncing(false);
  };

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

  // Update functions
  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    setUpdateProgress(null);
    try {
      const api = (window as any).electronAPI;
      if (!api?.checkForUpdates) {
        showToast('Auto-updater not available (dev mode)', 'error');
        setCheckingUpdate(false);
        return;
      }
      const result = await api.checkForUpdates();
      if (result.ok) {
        // `updateInfo` is always populated (latest server version), so rely on
        // `isUpdateAvailable` to decide whether an update is actually available.
        if (result.isUpdateAvailable && result.updateInfo) {
          setUpdateStatus({
            status: 'available',
            info: result.updateInfo,
            currentVersion: result.currentVersion,
          });
          showToast(`Update available: v${result.updateInfo.version}`, 'info');
        } else {
          const currentVersion = result.currentVersion || result.updateInfo?.version;
          setUpdateStatus({
            status: 'not-available',
            info: result.updateInfo,
            currentVersion,
          });
          showToast(
            currentVersion
              ? `You are on the latest version (v${currentVersion})`
              : 'You are on the latest version',
            'info',
          );
        }
      } else {
        setUpdateStatus({
          status: 'error',
          error: result.error,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          metadataMissing: result.metadataMissing,
          releaseUrl: result.releaseUrl,
        });
        showToast(`Update check failed: ${result.error}`, 'error');
      }
    } catch (err) {
      setUpdateStatus({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
      showToast('Update check failed', 'error');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const openReleasePage = async () => {
    const releaseUrl = updateStatus?.releaseUrl;
    if (!releaseUrl) return;

    try {
      const api = (window as any).electronAPI;
      const result = await api.openReleasePage?.(releaseUrl);
      if (result && !result.ok) {
        showToast(`Could not open the release page: ${result.error}`, 'error');
      }
    } catch (err) {
      showToast('Could not open the release page', 'error');
    }
  };

  const downloadUpdate = async () => {
    setDownloadingUpdate(true);
    setUpdateProgress({ percent: 0, bytesPerSecond: 0, total: 0, transferred: 0 });
    try {
      const api = (window as any).electronAPI;
      if (!api?.downloadUpdate) {
        showToast('Auto-updater not available', 'error');
        setDownloadingUpdate(false);
        return;
      }
      const result = await api.downloadUpdate();
      if (result.ok) {
        showToast('Update downloaded successfully', 'info');
      } else {
        showToast(`Download failed: ${result.error}`, 'error');
      }
    } catch (err) {
      showToast('Download failed', 'error');
    } finally {
      setDownloadingUpdate(false);
    }
  };

  const installUpdate = async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api?.installUpdate) {
        showToast('Auto-updater not available', 'error');
        return;
      }
      await api.installUpdate();
    } catch (err) {
      showToast('Install failed', 'error');
    }
  };

  // Listen for update events
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    const unsubStatus = api.onUpdateStatus?.((data: any) => {
      setUpdateStatus(data);
      if (data.status === 'available') {
        showToast(`Update available: v${data.info?.version}`, 'info');
      } else if (data.status === 'downloaded') {
        showToast('Update downloaded - restart to install', 'info');
        setDownloadingUpdate(false);
      } else if (data.status === 'error') {
        showToast(`Update error: ${data.error}`, 'error');
        setCheckingUpdate(false);
        setDownloadingUpdate(false);
      }
    });

    const unsubProgress = api.onUpdateProgress?.((data: any) => {
      setUpdateProgress(data);
    });

    return () => {
      unsubStatus?.();
      unsubProgress?.();
    };
  }, [showToast]);

  const ytmSyncBusy = ytSyncing || Boolean(librarySyncProgress?.inProgress);
  const ytAccountMutationBusy = signingInYtMusic || ytAccountMutationPending;

  return (
    <div className="space-y-8 pb-10 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          YouTube Music Account &amp; Region, Spotify Library Sync, Appearance Studio, Audio Quality, and Library Backups
        </p>
      </div>

      {/* YouTube Music Account & Library Sync */}
      <section
        aria-label="YouTube Music Account and Playback"
        className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Youtube className="w-4 h-4 text-[var(--md-primary)]" />
              <span>YouTube Music Account &amp; Playback</span>
            </h2>
            <p className="text-xs text-[var(--md-on-surface-variant)] mt-0.5">
              Sign in via your YouTube Music session (stored encrypted in OS vault) to sync Liked Songs, playlists, albums, artists, history, and personalized recommendations.
            </p>
          </div>
          {activeYtAccount && (
            <button
              type="button"
              disabled={ytAccountMutationPending}
              onClick={() => void signOutYtAccount(activeYtAccount.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          )}
        </div>

        {ytVaultDiagnostic?.unreadableFile && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 space-y-2">
            <div className="flex items-start gap-2 text-xs text-amber-200">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">The encrypted session vault could not be read.</div>
                <div className="mt-1 text-[11px] leading-snug text-amber-200/80 break-words">
                  {ytVaultDiagnostic.error ||
                    'Riri Player preserved the existing file and did not treat this as a sign-out.'}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={resettingYtVault}
              onClick={() => void handleResetYtVault()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {resettingYtVault ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              <span>Reset encrypted vault</span>
            </button>
          </div>
        )}

        {activeYtAccount ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[var(--md-surface-container)] border border-[var(--md-outline-variant)]/40">
              <div className="flex items-center gap-3 min-w-0">
                {activeYtAccount.avatarUrl ? (
                  <img
                    src={activeYtAccount.avatarUrl}
                    alt={activeYtAccount.name}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center font-bold text-sm shrink-0">
                    {activeYtAccount.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{activeYtAccount.name}</div>
                  <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                    {activeYtAccount.email || activeYtAccount.handle || 'Session active'}
                    {lastLibrarySyncAt
                      ? ` · Last synced ${new Date(lastLibrarySyncAt).toLocaleString()}`
                      : ''}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={ytAccountMutationBusy}
                  onClick={() => void handleYtmSignIn(true)}
                  className="px-3 py-2 rounded-xl bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] text-xs font-semibold cursor-pointer"
                >
                  Add Account
                </button>
                <button
                  type="button"
                  disabled={ytmSyncBusy}
                  onClick={() => void handleYtmSync()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${ytmSyncBusy ? 'animate-spin' : ''}`} />
                  <span>{ytmSyncBusy ? 'Syncing...' : 'Sync Library Now'}</span>
                </button>
              </div>
            </div>

            {librarySyncProgress?.inProgress && (
              <div className="space-y-1.5 p-3 rounded-xl bg-[var(--md-surface-container)]">
                <div className="flex justify-between text-[11px] text-[var(--md-on-surface-variant)]">
                  <span>{librarySyncProgress.message}</span>
                  <span>
                    {librarySyncProgress.completed}/{librarySyncProgress.total}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--md-surface-container-highest)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--md-primary)] transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (librarySyncProgress.completed /
                            Math.max(1, librarySyncProgress.total)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {ytLoginError && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 space-y-2">
                <div className="text-xs text-red-300 leading-snug">{ytLoginError}</div>
                {!ytLoginBlocked && (
                  <button
                    type="button"
                    disabled={ytAccountMutationBusy}
                    onClick={() => {
                      if (ytLoginRetryable) {
                        void retryYtMusicSignIn();
                      } else {
                        void handleYtmSignIn(true);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{ytLoginRetryable ? 'Try again' : 'Sign in again'}</span>
                  </button>
                )}
              </div>
            )}

            {ytAccounts.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {ytAccounts.map((acct) => {
                  const isCurrent = acct.id === activeYtAccount.id;
                  return (
                    <button
                      key={acct.id}
                      type="button"
                      disabled={ytAccountMutationPending}
                      onClick={() => !isCurrent && void switchYtAccount(acct.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                        isCurrent
                          ? 'border-[var(--md-primary)] bg-[var(--md-primary-container)]/40'
                          : 'border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)]'
                      }`}
                    >
                      {isCurrent && <Check className="w-3.5 h-3.5 text-[var(--md-primary)]" />}
                      <span>{acct.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={ytAccountMutationBusy}
                onClick={() => void handleYtmSignIn(false)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold hover:opacity-90 disabled:opacity-60 cursor-pointer"
              >
                {signingInYtMusic ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>
                  {signingInYtMusic ? 'Opening YouTube Music...' : 'Sign in to YouTube Music'}
                </span>
              </button>

              {ytLoginError && !ytLoginBlocked && (
                  <button
                    type="button"
                    disabled={ytAccountMutationBusy}
                    onClick={() => {
                      if (ytLoginRetryable) {
                        void retryYtMusicSignIn();
                      } else {
                        void handleYtmSignIn(true);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)] cursor-pointer disabled:opacity-60"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[var(--md-primary)]" />
                    <span>{ytLoginRetryable ? 'Try again' : 'Sign in again'}</span>
                  </button>
              )}
            </div>

            {ytLoginError && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-300">
                {ytLoginError}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div>
            <label htmlFor="ytm-region" className="block text-xs font-semibold mb-1.5">
              Content Region
            </label>
            <select
              id="ytm-region"
              value={settings.contentRegion}
              onChange={(e) => updateSettings({ contentRegion: e.target.value })}
              className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
            >
              {YTM_REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ytm-language" className="block text-xs font-semibold mb-1.5">
              Content Language
            </label>
            <select
              id="ytm-language"
              value={settings.contentLanguage}
              onChange={(e) => updateSettings({ contentLanguage: e.target.value })}
              className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
            >
              {YTM_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ytm-quality" className="block text-xs font-semibold mb-1.5">
              Audio Stream Quality
            </label>
            <select
              id="ytm-quality"
              value={settings.preferredAudioQuality}
              onChange={(e) =>
                updateSettings({
                  preferredAudioQuality: e.target.value as AppSettings['preferredAudioQuality'],
                })
              }
              className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
            >
              <option value="AUTO">Auto</option>
              <option value="LOW">Low (~64 kbps)</option>
              <option value="MEDIUM">Medium (~128 kbps)</option>
              <option value="HIGH">High (~160–256 kbps)</option>
              <option value="MAX">Maximum Available</option>
            </select>
          </div>
        </div>
      </section>

      {/* Spotify Library Sync */}
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
              Sign in with Spotify to sync your playlists, albums, artists, and Liked Songs into Riri Player (matched onto YouTube Music).
            </p>
          </div>
          {spotifyConnection?.loggedIn && (
            <button
              type="button"
              onClick={() => void disconnectSpotifyAccount()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          )}
        </div>

        {spotifyConnection?.loggedIn ? (
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
                      Spotify Session
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                    {spotifyConnection.email ||
                      spotifyConnection.profileUrl ||
                      'Connected via Spotify Web Session'}
                    {spotifyConnection.lastSyncedAt
                      ? ` · Last synced ${new Date(spotifyConnection.lastSyncedAt).toLocaleString()}`
                      : ' · Ready to sync'}
                  </div>
                  {typeof spotifyConnection.lastSyncedCount === 'number' && (
                    <div className="text-[11px] text-[#1DB954] font-medium">
                      {spotifyConnection.lastSyncedCount} track(s) matched (
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

            {/* Spotify Sync Progress Bar */}
            {spotifySyncProgress?.inProgress && (
              <div className="space-y-1.5 p-3 rounded-xl bg-[#1DB954]/10 border border-[#1DB954]/30">
                <div className="flex justify-between text-[11px] text-[#1DB954]">
                  <span>{spotifySyncProgress.message}</span>
                  <span>
                    {spotifySyncProgress.completed}/{spotifySyncProgress.total}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#1DB954]/30 overflow-hidden">
                  <div
                    className="h-full bg-[#1DB954] transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (spotifySyncProgress.completed /
                            Math.max(1, spotifySyncProgress.total)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
                {spotifySyncProgress.currentItem && (
                  <div className="text-[10px] text-[var(--md-on-surface-variant)]">
                    {spotifySyncProgress.currentItem}
                  </div>
                )}
              </div>
            )}

            {spotifySyncProgress?.phase === 'complete' && (
              <div className="text-[11px] text-emerald-400 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/30">
                {spotifySyncProgress.message}
              </div>
            )}

            {spotifySyncProgress?.phase === 'error' && (
              <div className="text-[11px] text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/30">
                {spotifySyncProgress.message}
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
                    void updateSpotifySchedule(e.target.value as SpotifySyncSchedule)
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
                When scheduled, Riri Player refreshes your Spotify Liked Songs and Playlists automatically.
              </div>
            </div>

            {spotifyUnmatchedTracks.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2">
                <div className="text-xs font-bold text-amber-200">
                  Unmatched Spotify Tracks ({spotifyUnmatchedTracks.length})
                </div>
                <div className="max-h-44 overflow-y-auto space-y-1.5">
                  {spotifyUnmatchedTracks.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-2 text-xs bg-black/20 rounded-lg px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{u.name}</div>
                        <div className="text-[11px] text-[var(--md-on-surface-variant)] truncate">
                          {u.artist}
                          {u.playlistName ? ` · ${u.playlistName}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setGlobalSearchQuery(`${u.artist} ${u.name}`);
                            navigate('search');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--md-surface-container-high)] hover:brightness-110 text-[11px] font-semibold cursor-pointer"
                        >
                          <Search className="w-3 h-3" />
                          <span>Find</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void dismissSpotifyUnmatched(u.id)}
                          className="p-1 rounded-lg hover:bg-white/10 cursor-pointer"
                          title="Dismiss unmatched track"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                  ? 'Opening Spotify Sign-In...'
                  : 'Sign in with Spotify to Link Library'}
              </span>
            </button>
          </div>
        )}
      </section>

      {/* Multi-Provider Lyrics (ArchiveTune Architecture) */}
      <section
        aria-label="Lyrics & Providers"
        className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Mic className="w-4 h-4 text-[var(--md-primary)]" />
              <span>Lyrics & Sources (ArchiveTune Engine)</span>
            </h2>
            <p className="text-xs text-[var(--md-on-surface-variant)] mt-0.5">
              Select multiple synchronized lyrics providers, manage query priority, and customize Native vs English transliteration.
            </p>
          </div>
        </div>

        {/* Provider Priority and Toggles */}
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)]">
            Active Provider Priority (Queried in order)
          </div>
          <div className="space-y-2">
            {currentProviders.map((providerId, idx) => {
              const catalogItem = LYRICS_PROVIDERS_CATALOG.find((p) => p.id === providerId);
              if (!catalogItem) return null;
              return (
                <div
                  key={providerId}
                  className="flex items-center justify-between p-3 rounded-xl bg-[var(--md-surface-container)] border border-[var(--md-outline-variant)]/30 transition-all hover:bg-[var(--md-surface-container-high)]"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] text-[11px] font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold leading-tight">{catalogItem.name}</span>
                        {catalogItem.supportsSynced ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/15 text-emerald-400">
                            Synced Timeline
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/10 text-[var(--md-on-surface-variant)]">
                            Plain Lyrics
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--md-on-surface-variant)] mt-0.5 leading-snug truncate">
                        {catalogItem.description}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveLyricsProvider(idx, 'up')}
                      aria-label={`Move ${catalogItem.name} up`}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === currentProviders.length - 1}
                      onClick={() => moveLyricsProvider(idx, 'down')}
                      aria-label={`Move ${catalogItem.name} down`}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--md-on-surface-variant)] hover:text-[var(--md-on-surface)] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleLyricsProvider(providerId)}
                      aria-label={`Disable ${catalogItem.name}`}
                      className="ml-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer transition-colors"
                    >
                      Disable
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inactive providers */}
          {LYRICS_PROVIDERS_CATALOG.some((p) => !currentProviders.includes(p.id)) && (
            <div className="pt-2">
              <div className="text-[11px] font-semibold text-[var(--md-on-surface-variant)] mb-2">
                Available Inactive Providers
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {LYRICS_PROVIDERS_CATALOG.filter((p) => !currentProviders.includes(p.id)).map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--md-surface-container)]/50 border border-[var(--md-outline-variant)]/20"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-semibold">{provider.name}</div>
                      <div className="text-[10px] text-[var(--md-on-surface-variant)] truncate">{provider.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleLyricsProvider(provider.id)}
                      className="px-2 py-1 rounded-lg text-xs font-semibold bg-[var(--md-primary)]/15 text-[var(--md-primary)] hover:bg-[var(--md-primary)]/25 cursor-pointer shrink-0 transition-colors"
                    >
                      Enable
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Preferred Lyrics Language & Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[var(--md-outline-variant)]/30">
          <div>
            <label htmlFor="preferred-lyrics-language" className="block text-xs font-semibold mb-1">
              Preferred Lyrics Language
            </label>
            <p className="text-[11px] text-[var(--md-on-surface-variant)] mb-2">
              Default language style for foreign tracks. Switch option will only appear when a song actually has an alternate language.
            </p>
            <select
              id="preferred-lyrics-language"
              value={settings.lyricsLanguage}
              onChange={(e) =>
                updateSettings({
                  lyricsLanguage: e.target.value as 'NATIVE' | 'ENGLISH',
                })
              }
              className="w-full h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
            >
              <option value="NATIVE">Native Language (Original Script)</option>
              <option value="ENGLISH">English (Transliteration / Translation)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">
              Live Lyrics Sync Offset ({settings.lyricsOffsetMs > 0 ? `+${settings.lyricsOffsetMs}` : settings.lyricsOffsetMs} ms)
            </label>
            <p className="text-[11px] text-[var(--md-on-surface-variant)] mb-2">
              Fine-tune the timeline synchronization speed if lyrics are leading or lagging.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateSettings({ lyricsOffsetMs: (settings.lyricsOffsetMs || 0) - 200 })}
                className="px-3 h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] text-xs font-bold hover:bg-[var(--md-surface-container-high)] cursor-pointer"
              >
                -200ms
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ lyricsOffsetMs: 0 })}
                className="flex-1 h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] text-xs font-semibold hover:bg-[var(--md-surface-container-high)] cursor-pointer"
              >
                Reset (0 ms)
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ lyricsOffsetMs: (settings.lyricsOffsetMs || 0) + 200 })}
                className="px-3 h-10 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] text-xs font-bold hover:bg-[var(--md-surface-container-high)] cursor-pointer"
              >
                +200ms
              </button>
            </div>
          </div>
        </div>

        {/* Translation subtitle and Font Scale */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ToggleSwitch
            checked={settings.showSyncedLyricsTranslation}
            onChange={(checked) => updateSettings({ showSyncedLyricsTranslation: checked })}
            label="Translation Subtitles"
            description="Display real-time translated lyrics subtitle line below active karaoke lines"
            icon={<Languages className="w-4 h-4" />}
          />

          <div>
            <label htmlFor="lyrics-font-scale" className="block text-xs font-semibold mb-1">
              Lyrics Font Size Scale ({Math.round(settings.lyricsFontScale * 100)}%)
            </label>
            <p className="text-[11px] text-[var(--md-on-surface-variant)] mb-2">
              Scale lyrics text size in Full Player and cinema view.
            </p>
            <input
              id="lyrics-font-scale"
              type="range"
              min="0.75"
              max="1.5"
              step="0.05"
              value={settings.lyricsFontScale}
              onChange={(e) => updateSettings({ lyricsFontScale: parseFloat(e.target.value) })}
              className="w-full accent-[var(--md-primary)] cursor-pointer"
            />
          </div>
        </div>
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

        <div>
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
          Export your playlists, liked tracks, YouTube Music & Spotify accounts (metadata only), EQ profiles, listening stats, and preferences to a portable JSON file (credentials are never exported).
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

      {/* Auto-Update */}
      <section className="at-glass-card rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-4">
        <h2 className="text-base font-bold flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-[var(--md-primary)]" />
          <span>Auto-Update</span>
        </h2>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          Check for updates, enable automatic downloads, and install new versions from GitHub Releases.
        </p>

        <div className="space-y-3">
          {/* Update Status */}
          {updateStatus && (
            <div className="rounded-xl p-3.5 space-y-2 border bg-[var(--md-surface-container)]">
              <div className="flex items-center gap-2">
                {updateStatus.status === 'checking' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--md-primary)]" />
                    <span className="text-xs font-semibold text-[var(--md-primary)]">Checking for updates...</span>
                  </>
                )}
                {updateStatus.status === 'available' && (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold text-amber-400">
                      Update Available: v{updateStatus.info?.version} ({updateStatus.info?.releaseDate?.split('T')[0]})
                    </span>
                  </>
                )}
                {updateStatus.status === 'not-available' && (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-400">
                      You are on the latest version
                      {updateStatus.currentVersion ? ` (v${updateStatus.currentVersion})` : ''}
                    </span>
                  </>
                )}
                {updateStatus.status === 'downloaded' && (
                  <>
                    <CheckCircle className="w-4 h-4 text-[var(--md-primary)]" />
                    <span className="text-xs font-semibold text-[var(--md-primary)]">Update downloaded - restart to install</span>
                  </>
                )}
                {updateStatus.status === 'error' && (
                  <>
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-semibold text-red-400">Error: {updateStatus.error}</span>
                  </>
                )}
              </div>

              {updateStatus.info?.releaseNotes && updateStatus.status === 'available' && (
                <details className="group">
                  <summary className="text-xs text-[var(--md-primary)] cursor-pointer hover:underline flex items-center gap-1">
                    <span>View Release Notes</span>
                    <Wifi className="w-3 h-3" />
                  </summary>
                  <div className="mt-2 p-3 rounded-lg bg-[var(--md-surface-container-low)] text-xs text-[var(--md-on-surface-variant)] whitespace-pre-wrap border border-[var(--md-outline-variant)]/30 max-h-48 overflow-y-auto">
                    {updateStatus.info.releaseNotes}
                  </div>
                </details>
              )}

              {/* Download Progress */}
              {updateProgress && (updateStatus.status === 'available' || downloadingUpdate) && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-[var(--md-on-surface-variant)]">
                    <span>Downloading: {Math.round(updateProgress.percent)}%</span>
                    <span>{(updateProgress.transferred / 1024 / 1024).toFixed(1)} / {(updateProgress.total / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--md-surface-container-highest)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--md-primary)] transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, updateProgress.percent))}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--md-on-surface-variant)]">
                    {updateProgress.bytesPerSecond > 0 && `${(updateProgress.bytesPerSecond / 1024).toFixed(0)} KB/s`}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-2">
                {updateStatus.status === 'available' && !downloadingUpdate && (
                  <button
                    type="button"
                    onClick={downloadUpdate}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Update</span>
                  </button>
                )}
                {updateStatus.status === 'downloaded' && (
                  <button
                    type="button"
                    onClick={installUpdate}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Install & Restart</span>
                  </button>
                )}
                {updateStatus.status === 'error' && updateStatus.metadataMissing && updateStatus.releaseUrl && (
                  <button
                    type="button"
                    onClick={openReleasePage}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      Download v{updateStatus.latestVersion || 'latest'} manually
                    </span>
                  </button>
                )}
                {updateStatus.status === 'error' && (
                  <button
                    type="button"
                    onClick={checkForUpdates}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] text-xs font-semibold cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Manual Check Button */}
          {!updateStatus || updateStatus.status === 'not-available' || updateStatus.status === 'error' ? (
            <button
              type="button"
              onClick={checkForUpdates}
              disabled={checkingUpdate}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              {checkingUpdate ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{checkingUpdate ? 'Checking...' : 'Check for Updates'}</span>
            </button>
          ) : null}

          {/* Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <ToggleSwitch
              checked={checkOnStartupEnabled}
              onChange={(checked) => setCheckOnStartupEnabled(checked)}
              label="Check for updates on startup"
              description="Automatically check for new versions when Riri Player starts"
            />
            <ToggleSwitch
              checked={autoDownloadEnabled}
              onChange={(checked) => setAutoDownloadEnabled(checked)}
              label="Auto-download updates"
              description="Automatically download updates in background when available"
            />
          </div>

          <div className="text-[11px] text-[var(--md-on-surface-variant)] pt-2 border-t border-[var(--md-outline-variant)]/30">
            Updates are fetched from <a href="https://github.com/feelthevenom/Riri-Player/releases" target="_blank" rel="noopener noreferrer" className="text-[var(--md-primary)] hover:underline">GitHub Releases</a>.
            Both Setup (.exe) and Portable versions are available.
          </div>
        </div>
      </section>

      {/* Local Data & Factory Reset */}
      <section className="at-glass-card rounded-2xl border border-red-500/20 bg-[var(--md-surface-container-low)] p-5 space-y-4">
        <h2 className="text-base font-bold flex items-center gap-2 text-red-400">
          <Trash2 className="w-4 h-4 text-red-400" />
          <span>Local Data &amp; Reset</span>
        </h2>
        <p className="text-xs text-[var(--md-on-surface-variant)]">
          All your imported Spotify playlists, local tracks, and listening history are stored only in your local application profile (<code className="font-mono text-[11px] bg-[var(--md-surface-container-highest)] px-1.5 py-0.5 rounded">%APPDATA%/riri-player</code>). None of your personal data is stored in the repository or code files.
        </p>

        <div className="pt-1">
          <button
            type="button"
            disabled={resettingAllData}
            onClick={() => {
              if (
                window.confirm(
                  'Are you sure you want to clear all local playlists, library data, and cache? This will also sign out of every YouTube Music account. The reset is canceled if browser-session cleanup fails.',
                )
              ) {
                setResettingAllData(true);
                void resetAllUserData()
                  .catch((error) => {
                    const message =
                      error instanceof Error
                        ? error.message
                        : 'Could not reset all local data.';
                    showToast(message, 'error');
                  })
                  .finally(() => setResettingAllData(false));
              }
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-bold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            <span>Reset All Local Data &amp; Playlists</span>
          </button>
        </div>
      </section>
    </div>
  );
};
