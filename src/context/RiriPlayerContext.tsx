import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppSettings,
  ArchPlugin,
  EqProfile,
  LibraryFilter,
  LibrarySyncProgress,
  NavigationView,
  PlayEvent,
  Playlist,
  PlaylistTag,
  RepeatMode,
  ScreenRoute,
  SponsorBlockSegment,
  SpotifyConnection,
  SpotifySyncProgress,
  SpotifySyncSchedule,
  Track,
  UnmatchedSpotifyTrack,
  YtAccountSummary,
  YtAuthStatusPayload,
  YtMusicBrowseItem,
  YtMusicChip,
  YtMusicHomeSection,
  YtMusicNextResult,
} from '../types/music';
import {
  DEFAULT_EQ_PROFILES,
  DEFAULT_PLAYLISTS,
  DEFAULT_SETTINGS,
  DEFAULT_TAGS,
  FALLBACK_ARTWORK_DATA_URL,
} from '../data/catalog';
import { applyMaterialTheme, extractPaletteFromArtwork } from '../utils/themeEngine';
import { audioEngine } from '../utils/audioEngine';
import {
  clearAllLocalDatabase,
  loadLibraryStateFromDb,
  loadQueueStateFromDb,
  saveLibraryStateToDb,
  saveLocalAudioBlob,
  saveQueueStateToDb,
} from '../utils/storageDb';
import { runArchPluginSearch, resolveArchPluginStream } from '../utils/archPluginRunner';
import { findActiveLyricIndex, parseLrcLyrics } from '../utils/lyricsParser';
import {
  appendUniqueQueueSuggestions,
  replaceUpcomingQueueWithRadio,
} from '../utils/queueHelpers';
import { isSpotifyAutoSyncDue } from '../utils/spotifySyncHelpers';
import {
  apiFetch,
  getElectronBridge,
  initYtmProxyConfig,
  ytmClient,
  decorateProxyUrl,
} from '../utils/ytmClient';

const SETTINGS_KEY = 'ririp_c_settings_v2';
const EQ_STORAGE_KEY = 'ririp_c_eq_v2';
const MINI_OVERLAY_CHANNEL = 'riri_mini_overlay';
const YT_AUTH_LOCAL_KEY = 'ririp_c_yt_auth_v1';

function redecorateTrack(t: Track): Track {
  return {
    ...t,
    thumbnailUrl: t.thumbnailUrl ? decorateProxyUrl(t.thumbnailUrl) : t.thumbnailUrl,
  };
}

function redecoratePlaylist(pl: Playlist): Playlist {
  return {
    ...pl,
    coverUrl: pl.coverUrl ? decorateProxyUrl(pl.coverUrl) : undefined,
  };
}

function redecorateBrowseItem(item: YtMusicBrowseItem): YtMusicBrowseItem {
  return {
    ...item,
    thumbnailUrl: item.thumbnailUrl ? decorateProxyUrl(item.thumbnailUrl) : item.thumbnailUrl,
  };
}

export type RightPanelTab = 'closed' | 'lyrics' | 'queue';

export interface ContextMenuState {
  track: Track;
  x: number;
  y: number;
}

export interface ToastState {
  id: number;
  message: string;
  type: 'info' | 'error';
}

const LANG_ISO_MAP: Record<string, string> = {
  ENGLISH: 'en',
  JAPANESE: 'ja',
  KOREAN: 'ko',
  CHINESE_SIMPLIFIED: 'zh-CN',
  CHINESE_TRADITIONAL: 'zh-TW',
  SPANISH: 'es',
  FRENCH: 'fr',
  GERMAN: 'de',
  ITALIAN: 'it',
  PORTUGUESE: 'pt',
  RUSSIAN: 'ru',
  ARABIC: 'ar',
  HINDI: 'hi',
  INDONESIAN: 'id',
  VIETNAMESE: 'vi',
  THAI: 'th',
  TURKISH: 'tr',
  POLISH: 'pl',
  DUTCH: 'nl',
  UKRAINIAN: 'uk',
};

interface RiriPlayerContextValue {
  route: ScreenRoute;
  routeParam?: string;
  navigate: (route: ScreenRoute, param?: string) => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;

  homeChip: string;
  setHomeChip: (chipId: string) => void;
  homeTracks: Track[];
  homeSections: YtMusicHomeSection[];
  homeChips: YtMusicChip[];
  selectedHomeChipParams: string | null;
  setSelectedHomeChipParams: (params: string | null) => void;
  homeSourceLabel: string;
  homeLoading: boolean;
  chartsTracks: Track[];
  chartsLoading: boolean;
  loadCharts: () => Promise<void>;

  browsedCollections: Record<
    string,
    { title: string; subtitle: string; tracks: Track[]; cards: YtMusicBrowseItem[]; loading?: boolean }
  >;
  openYtMusicBrowse: (browseId: string, titleHint?: string, params?: string) => Promise<void>;

  tracks: Track[];
  playlists: Playlist[];
  tags: PlaylistTag[];
  playEvents: PlayEvent[];
  searchHistory: string[];
  plugins: ArchPlugin[];
  settings: AppSettings;
  volume: number;

  ytAuthStatus: YtAuthStatusPayload | null;
  ytVaultDiagnostic: { error?: string; unreadableFile?: boolean } | null;
  ytAccounts: YtAccountSummary[];
  activeYtAccount: YtAccountSummary | null;
  signingInYtMusic: boolean;
  ytLoginError: string | null;
  clearYtLoginError: () => void;
  ytSavedAlbums: YtMusicBrowseItem[];
  ytFollowedArtists: YtMusicBrowseItem[];
  ytUploadedTracks: Track[];
  ytHistoryTracks: Track[];
  librarySyncProgress: LibrarySyncProgress | null;
  lastLibrarySyncAt: number | null;
  signInWithYouTubeMusic: (options?: {
    cleanPartition?: boolean;
  }) => Promise<{ ok: boolean; blocked?: boolean; cancelled?: boolean; message: string }>;
  cancelYtMusicSignIn: () => Promise<void>;
  importYtmBrowserSession: (payload: {
    cookieHeader: string;
    visitorData?: string;
    dataSyncId?: string;
    accountIndex?: number;
  }) => Promise<{ ok: boolean; message: string }>;
  switchYtAccount: (accountId: string) => Promise<void>;
  signOutYtAccount: (accountId?: string) => Promise<void>;
  syncYtMusicLibrary: () => Promise<{ ok: boolean; message: string }>;

  spotifyConnection: SpotifyConnection | null;
  spotifySyncing: boolean;
  spotifySyncProgress: SpotifySyncProgress | null;
  spotifyUnmatchedTracks: UnmatchedSpotifyTrack[];
  connectSpotifyAccount: () => Promise<{ ok: boolean; message: string }>;
  disconnectSpotifyAccount: () => Promise<void>;
  syncSpotifyLibrary: (silent?: boolean) => Promise<{ ok: boolean; message: string }>;
  updateSpotifySchedule: (schedule: SpotifySyncSchedule) => Promise<void>;
  dismissSpotifyUnmatched: (trackId: string) => Promise<void>;

  eqProfiles: EqProfile[];
  activeEqId: string;
  activeEq: EqProfile;

  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;

  queueNextResult: YtMusicNextResult | null;
  queueNextLoading: boolean;
  fetchQueueNext: (
    videoId?: string,
    playlistId?: string,
    params?: string,
    followAutomixPreview?: boolean,
    options?: { replaceUpcoming?: boolean; title?: string; artist?: string },
  ) => Promise<Track[]>;
  loadMoreQueueNext: () => Promise<Track[]>;
  toggleQueueChip: (chipId: string) => Promise<void>;

  sleepTimerMinLeft: number | null;
  setSleepTimer: (minutes: number | null) => void;

  rightPanel: RightPanelTab;
  setRightPanel: (tab: RightPanelTab) => void;
  toggleRightPanel: (tab: 'lyrics' | 'queue') => void;
  fullscreenPlayer: boolean;
  setFullscreenPlayer: (open: boolean) => void;
  isAppFullscreen: boolean;
  toggleAppFullscreen: () => void;
  showMiniOverlay: boolean;
  setShowMiniOverlay: (open: boolean) => void;
  openMiniPlayer: () => void;
  closeMiniPlayer: (openCinema?: boolean) => void;
  showEqModal: boolean;
  setShowEqModal: (open: boolean) => void;
  showSpotifyModal: boolean;
  setShowSpotifyModal: (open: boolean) => void;
  contextMenu: ContextMenuState | null;
  setContextMenu: (menu: ContextMenuState | null) => void;
  toast: ToastState | null;
  showToast: (message: string, type?: 'info' | 'error') => void;

  globalSearchQuery: string;
  setGlobalSearchQuery: (q: string) => void;
  searchOnlineTracks: (query: string) => Promise<Track[]>;
  searchYtMusicTracks: (query: string, filter?: string) => Promise<Track[]>;
  searchYtMusicFull: (
    query: string,
    filter?: string,
  ) => Promise<{ tracks: Track[]; cards: YtMusicBrowseItem[] }>;
  fetchSearchSuggestions: (
    query: string,
  ) => Promise<{ queries: string[]; items: YtMusicBrowseItem[] }>;

  playTrack: (track: Track, newQueue?: Track[]) => Promise<void>;
  playNext: (track: Track) => void;
  togglePlayPause: () => Promise<void>;
  nextTrack: () => Promise<void>;
  prevTrack: () => Promise<void>;
  seekTo: (sec: number) => void;
  addToQueue: (track: Track) => void;
  moveQueueItem: (fromIdx: number, toIdx: number) => void;
  removeQueueItem: (idx: number) => void;
  clearQueue: () => void;
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;

  toggleLike: (trackId: string, trackData?: Track) => void;
  isTrackLiked: (trackId: string) => boolean;
  createPlaylist: (name: string, description?: string, initialTracks?: Track[]) => Playlist;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  deletePlaylist: (playlistId: string) => void;
  exportPlaylistM3u: (playlistId: string) => void;
  importSpotifyPlaylist: (
    input: string,
  ) => Promise<{ ok: boolean; message: string; playlistId?: string; unmatchedTracks?: UnmatchedSpotifyTrack[] }>;
  importYtMusicPlaylist: (input: string) => Promise<{ ok: boolean; message: string; playlistId?: string }>;
  importLocalFiles: (files: FileList | File[]) => Promise<number>;

  addPlugin: (plugin: Omit<ArchPlugin, 'id' | 'addedAt'>) => ArchPlugin;
  togglePlugin: (pluginId: string) => void;
  removePlugin: (pluginId: string) => void;

  libraryFilter: LibraryFilter;
  setLibraryFilter: (f: LibraryFilter) => void;
  selectedTagId: string | null;
  setSelectedTagId: (id: string | null) => void;

  recordSearchQuery: (q: string) => void;
  clearSearchHistory: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;

  selectEqProfile: (id: string) => void;
  updateEqBand: (bandIndex: number, db: number) => void;
  updateEqParams: (patch: Partial<EqProfile>) => void;

  exportBackupJson: () => string;
  importBackupJson: (jsonText: string) => { ok: boolean; message: string };
  resetAllUserData: () => Promise<void>;
  dynamicArtworkSecondary: string;
  activeTrackLyrics: {
    syncedLyrics: string | null;
    plainLyrics: string | null;
    translations: string[];
    source: string | null;
    loading: boolean;
  };
  refreshCurrentLyrics: () => Promise<void>;
}

const RiriPlayerContext = createContext<RiriPlayerContextValue | null>(null);

function loadLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readAudioFileDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = new Audio();
    const done = (val: number) => {
      el.removeAttribute('src');
      el.load();
      resolve(val);
    };
    const timer = window.setTimeout(() => done(180), 2500);
    el.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer);
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : 180;
      done(dur);
    });
    el.addEventListener('error', () => {
      window.clearTimeout(timer);
      done(180);
    });
    el.src = url;
  });
}

function extractYtmBrowseIdFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes('://')) {
      const parsed = new URL(trimmed);
      const list = parsed.searchParams.get('list');
      if (list) return list;
      const browseMatch = parsed.pathname.match(/\/browse\/([A-Za-z0-9_-]+)/);
      if (browseMatch?.[1]) return browseMatch[1];
    }
  } catch {
    // ignore URL parse error
  }
  const listParamMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (listParamMatch?.[1]) return listParamMatch[1];
  if (/^[A-Za-z0-9_-]{8,}$/.test(trimmed)) return trimmed;
  return null;
}

export const RiriPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [navHistory, setNavHistory] = useState<NavigationView[]>([{ route: 'home' }]);
  const [navIndex, setNavIndex] = useState(0);
  const currentView = navHistory[navIndex] || { route: 'home' };

  const [homeChip, setHomeChip] = useState('all');
  const [homeTracks, setHomeTracks] = useState<Track[]>([]);
  const [homeSections, setHomeSections] = useState<YtMusicHomeSection[]>([]);
  const [homeChips, setHomeChips] = useState<YtMusicChip[]>([]);
  const [selectedHomeChipParams, setSelectedHomeChipParams] = useState<string | null>(null);
  const [homeSourceLabel, setHomeSourceLabel] = useState('YouTube Music');
  const [homeLoading, setHomeLoading] = useState(true);
  const [chartsTracks, setChartsTracks] = useState<Track[]>([]);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [browsedCollections, setBrowsedCollections] = useState<
    Record<
      string,
      { title: string; subtitle: string; tracks: Track[]; cards: YtMusicBrowseItem[]; loading?: boolean }
    >
  >({});

  const [dbHydrated, setDbHydrated] = useState(false);
  const [proxyReady, setProxyReady] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>(DEFAULT_PLAYLISTS);
  const [tags, setTags] = useState<PlaylistTag[]>(DEFAULT_TAGS);
  const [playEvents, setPlayEvents] = useState<PlayEvent[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<ArchPlugin[]>([]);

  const [ytAuthStatus, setYtAuthStatus] = useState<YtAuthStatusPayload | null>(null);
  const [ytVaultDiagnostic, setYtVaultDiagnostic] = useState<{ error?: string; unreadableFile?: boolean } | null>(null);
  const [signingInYtMusic, setSigningInYtMusic] = useState(false);
  const [ytSavedAlbums, setYtSavedAlbums] = useState<YtMusicBrowseItem[]>([]);
  const [ytFollowedArtists, setYtFollowedArtists] = useState<YtMusicBrowseItem[]>([]);
  const [ytUploadedTracks, setYtUploadedTracks] = useState<Track[]>([]);
  const [ytHistoryTracks, setYtHistoryTracks] = useState<Track[]>([]);
  const [librarySyncProgress, setLibrarySyncProgress] = useState<LibrarySyncProgress | null>(null);
  const [lastLibrarySyncAt, setLastLibrarySyncAt] = useState<number | null>(null);

  const [spotifyConnection, setSpotifyConnection] = useState<SpotifyConnection | null>(null);
  const [spotifySyncing, setSpotifySyncing] = useState(false);
  const [spotifySyncProgress, setSpotifySyncProgress] = useState<SpotifySyncProgress | null>(null);
  const [sessionUnmatchedTracks, setSessionUnmatchedTracks] = useState<UnmatchedSpotifyTrack[]>([]);

  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...loadLocalJson<Partial<AppSettings>>(SETTINGS_KEY, {}),
  }));

  const [eqState, setEqState] = useState<{ profiles: EqProfile[]; activeId: string }>(() => {
    const loaded = loadLocalJson(EQ_STORAGE_KEY, {
      profiles: DEFAULT_EQ_PROFILES,
      activeId: 'eq-riri-warm',
    });
    return {
      ...loaded,
      activeId: loaded.activeId === 'eq-archivetune' ? 'eq-riri-warm' : loaded.activeId,
    };
  });

  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const queueRef = useRef<Track[]>([]);
  const queueIndexRef = useRef(0);
  const currentTrackRef = useRef<Track | null>(null);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    queueIndexRef.current = queueIndex;
  }, [queueIndex]);
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('OFF');
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [queueNextResult, setQueueNextResult] = useState<YtMusicNextResult | null>(null);
  const [queueNextLoading, setQueueNextLoading] = useState(false);
  const fetchQueueNextRef = useRef<typeof fetchQueueNext | null>(null);
  const loadMoreQueueNextRef = useRef<typeof loadMoreQueueNext | null>(null);
  const syncYtMusicLibraryRef = useRef<typeof syncYtMusicLibrary | null>(null);
  const [sleepTimerMinLeft, setSleepTimerMinLeft] = useState<number | null>(null);

  const [rightPanel, setRightPanel] = useState<RightPanelTab>('closed');
  const [fullscreenPlayer, setFullscreenPlayer] = useState(false);
  const [isAppFullscreen, setIsAppFullscreen] = useState<boolean>(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  );
  const [showMiniOverlay, setShowMiniOverlay] = useState(false);
  const [showEqModal, setShowEqModal] = useState(false);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');

  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('LIBRARY');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [ytLoginError, setYtLoginError] = useState<string | null>(null);
  const clearYtLoginError = useCallback(() => setYtLoginError(null), []);

  const [dynamicArtworkPrimary, setDynamicArtworkPrimary] = useState<string | null>(null);
  const [dynamicArtworkSecondary, setDynamicArtworkSecondary] = useState<string>('#1c1317');
  const [activeTrackLyrics, setActiveTrackLyrics] = useState<{
    syncedLyrics: string | null;
    plainLyrics: string | null;
    translations: string[];
    source: string | null;
    loading: boolean;
  }>({ syncedLyrics: null, plainLyrics: null, translations: [], source: null, loading: false });

  const ytAccounts = useMemo<YtAccountSummary[]>(
    () => ytAuthStatus?.accounts || [],
    [ytAuthStatus],
  );

  const activeYtAccount = useMemo<YtAccountSummary | null>(() => {
    if (!ytAuthStatus?.loggedIn) return null;
    const list = ytAuthStatus.accounts || [];
    return (
      list.find((a) => a.accountIndex === ytAuthStatus.accountIndex) ||
      list[0] || {
        id: 'ytm-active',
        name: ytAuthStatus.accountName || 'YouTube Music User',
        email: ytAuthStatus.email || undefined,
        avatarUrl: ytAuthStatus.avatar || undefined,
        accountIndex: ytAuthStatus.accountIndex || 0,
        visitorData: ytAuthStatus.visitorData || undefined,
        addedAt: Date.now(),
      }
    );
  }, [ytAuthStatus]);

  const spotifyUnmatchedTracks = useMemo<UnmatchedSpotifyTrack[]>(() => {
    const connList = spotifyConnection?.unmatchedTracks || [];
    const merged = new Map<string, UnmatchedSpotifyTrack>();
    for (const item of [...connList, ...sessionUnmatchedTracks]) {
      merged.set(item.id, item);
    }
    return Array.from(merged.values());
  }, [sessionUnmatchedTracks, spotifyConnection?.unmatchedTracks]);

  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    const id = Date.now();
    setToast({ id, message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 4200);
  }, []);

  // Subscribe to fullscreen / mini-overlay / sync progress
  useEffect(() => {
    // Initialize Electron proxy config (launch secret for packaged app)
    let cancelled = false;
    initYtmProxyConfig()
      .then(() => {
        if (!cancelled) setProxyReady(true);
      })
      .catch((err) => {
        console.error('[Proxy Config] Failed to initialize:', err);
        if (!cancelled) setProxyReady(false); // Don't mark ready on error
      });

    const onFsChange = () => {
      setIsAppFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    const api = getElectronBridge();
    const unsubFs = api?.onFullscreenState?.((fs: boolean) => setIsAppFullscreen(Boolean(fs)));
    const unsubCinema = api?.onRestoreCinema?.(() => {
      setShowMiniOverlay(false);
      setFullscreenPlayer(true);
    });
    const unsubOverlay = api?.onOverlayState?.((isActive: boolean) => {
      setShowMiniOverlay(Boolean(isActive));
    });
    const unsubProgress = api?.library?.onProgress?.((progress: LibrarySyncProgress) => {
      setLibrarySyncProgress(progress);
      if (progress.lastSyncedAt) {
        setLastLibrarySyncAt(progress.lastSyncedAt);
      }
    });

    return () => {
      cancelled = true;
      document.removeEventListener('fullscreenchange', onFsChange);
      unsubFs?.();
      unsubCinema?.();
      unsubOverlay?.();
      unsubProgress?.();
    };
  }, []);

  // Load main-process auth statuses (safeStorage-backed, zero raw cookies)
  useEffect(() => {
    if (!proxyReady) return;
    let cancelled = false;
    let retryTimer: NodeJS.Timeout | null = null;

    // Track whether we restored from localStorage backup.
    let restoredFromLocalStorage = false;

    // Restore auth status from localStorage backup immediately (before vault read).
    // This ensures the user stays signed in even if safeStorage decryption fails.
    try {
      const saved = localStorage.getItem(YT_AUTH_LOCAL_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as YtAuthStatusPayload;
        if (parsed?.loggedIn) {
          setYtAuthStatus(parsed);
          restoredFromLocalStorage = true;
        }
      }
    } catch {
      // ignore localStorage parse errors
    }

    // On every app start, invalidate the vault cache so a fresh read is forced.
    void ytmClient.invalidateYtmVaultCache();

    const fetchAuth = async () => {
      if (cancelled) return;
      const status = await ytmClient.getYtmStatus();
      if (!cancelled) {
        // Never overwrite a valid localStorage-restored session with empty vault data.
        // Only update if:
        //   - We haven't restored from localStorage yet, OR
        //   - The vault actually returned a logged-in status (fresher than backup)
        if (!restoredFromLocalStorage || status.loggedIn) {
          setYtAuthStatus(status);
          // Persist successful auth status to localStorage as a backup.
          if (status.loggedIn) {
            try {
              localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(status));
              restoredFromLocalStorage = true;
            } catch {
              // ignore
            }
          }
        }
      }
    };

    const initAuth = async () => {
      if (cancelled) return;

      // Fetch vault diagnostic first so we know whether the vault is readable.
      const diagnostic = await ytmClient.getYtmVaultDiagnostic().catch(() => null);
      if (!cancelled) {
        setYtVaultDiagnostic(diagnostic ?? null);
      }

      // Try auth status immediately.
      await fetchAuth();

      // If not logged in and the vault is unreadable (safeStorage not ready yet),
      // retry after a short delay so the async encryptor can initialize.
      // Skip retry if we already restored a valid session from localStorage.
      if (!cancelled && !restoredFromLocalStorage && diagnostic?.unreadableFile) {
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          void ytmClient.invalidateYtmVaultCache();
          void fetchAuth();

          // Second retry if still not logged in.
          if (!ytAuthStatus?.loggedIn) {
            retryTimer = setTimeout(() => {
              if (cancelled) return;
              void ytmClient.invalidateYtmVaultCache();
              void fetchAuth();
            }, 2000);
          }
        }, 1000);
      }
    };

    void initAuth();

    void ytmClient
      .getSpotifyStatus()
      .then((conn) => {
        if (!cancelled && conn) setSpotifyConnection(conn);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [proxyReady]);

  const toggleAppFullscreen = useCallback(() => {
    const api = getElectronBridge();
    if (api?.setFullscreen) {
      api.setFullscreen(!isAppFullscreen);
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => setIsAppFullscreen(false));
    } else if (document.documentElement.requestFullscreen) {
      void document.documentElement
        .requestFullscreen()
        .catch(() => setIsAppFullscreen((prev) => !prev));
    } else {
      setIsAppFullscreen((prev) => !prev);
    }
  }, [isAppFullscreen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleAppFullscreen();
      }
      // Exit app fullscreen with Escape key
      if (e.key === 'Escape' && isAppFullscreen) {
        e.preventDefault();
        toggleAppFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleAppFullscreen, isAppFullscreen]);

  const openMiniPlayer = useCallback(() => {
    const api = getElectronBridge();
    setFullscreenPlayer(false);
    if (api?.toggleOverlayWindow) {
      api.toggleOverlayWindow();
    } else {
      setShowMiniOverlay(true);
    }
  }, []);

  const closeMiniPlayer = useCallback((openCinema = false) => {
    const api = getElectronBridge();
    if (api?.closeOverlayWindow) {
      api.closeOverlayWindow();
    }
    setShowMiniOverlay(false);
    if (openCinema) {
      setFullscreenPlayer(true);
    }
  }, []);

  // Hydrate persistent library state + saved playback queue from IndexedDB
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadLibraryStateFromDb(), loadQueueStateFromDb()])
      .then(([persisted, savedQueue]) => {
        if (cancelled) return;
        if (persisted) {
          setTracks((persisted.tracks || []).map(redecorateTrack));
          setPlaylists(
            (persisted.playlists?.length ? persisted.playlists : DEFAULT_PLAYLISTS).map(
              redecoratePlaylist,
            ),
          );
          setTags(persisted.tags?.length ? persisted.tags : DEFAULT_TAGS);
          setPlayEvents(persisted.playEvents || []);
          setSearchHistory(persisted.searchHistory || []);
          setPlugins(persisted.plugins || []);
          setYtSavedAlbums((persisted.ytSavedAlbums || []).map(redecorateBrowseItem));
          setYtFollowedArtists((persisted.ytFollowedArtists || []).map(redecorateBrowseItem));
          setYtUploadedTracks((persisted.ytUploadedTracks || []).map(redecorateTrack));
          setYtHistoryTracks((persisted.ytHistoryTracks || []).map(redecorateTrack));
          if (persisted.lastLibrarySyncAt) {
            setLastLibrarySyncAt(persisted.lastLibrarySyncAt);
          }
          if (persisted.spotifyConnection) {
            setSpotifyConnection((curr) => curr || persisted.spotifyConnection || null);
          }
        }
        if (savedQueue && savedQueue.queue.length > 0) {
          const safeIdx = Math.max(
            0,
            Math.min(savedQueue.queueIndex || 0, savedQueue.queue.length - 1),
          );
          setQueue(savedQueue.queue);
          setQueueIndex(safeIdx);
          setRepeatMode(savedQueue.repeatMode || 'OFF');
          setShuffleEnabled(Boolean(savedQueue.shuffleEnabled));
          setCurrentTrack(savedQueue.queue[safeIdx] || null);
          setPositionSec(savedQueue.positionSec || 0);
          setDurationSec(savedQueue.queue[safeIdx]?.durationSec || 0);
        }
        setDbHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setDbHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist sanitized library state to IndexedDB
  useEffect(() => {
    if (!dbHydrated) return;
    const timer = window.setTimeout(() => {
      void saveLibraryStateToDb({
        tracks,
        playlists,
        tags,
        playEvents,
        searchHistory,
        plugins,
        ytSavedAlbums,
        ytFollowedArtists,
        ytUploadedTracks,
        ytHistoryTracks,
        lastLibrarySyncAt: lastLibrarySyncAt || undefined,
        spotifyConnection,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    dbHydrated,
    lastLibrarySyncAt,
    playEvents,
    playlists,
    plugins,
    searchHistory,
    spotifyConnection,
    tags,
    tracks,
    ytFollowedArtists,
    ytHistoryTracks,
    ytSavedAlbums,
    ytUploadedTracks,
  ]);

  // Persist queue snapshot periodically when queue changes
  useEffect(() => {
    if (!dbHydrated) return;
    const timer = window.setTimeout(() => {
      void saveQueueStateToDb({
        queue,
        queueIndex,
        repeatMode,
        shuffleEnabled,
        positionSec,
        savedAt: Date.now(),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dbHydrated, positionSec, queue, queueIndex, repeatMode, shuffleEnabled]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(eqState));
  }, [eqState]);

  // Sleep timer countdown
  useEffect(() => {
    if (sleepTimerMinLeft === null) return;
    if (sleepTimerMinLeft <= 0) {
      audioEngine.pause();
      setIsPlaying(false);
      setSleepTimerMinLeft(null);
      showToast('Sleep timer expired — playback paused.');
      return;
    }
    const id = window.setTimeout(() => {
      setSleepTimerMinLeft((m) => (m !== null ? m - 1 : null));
    }, 60_000);
    return () => window.clearTimeout(id);
  }, [sleepTimerMinLeft, showToast]);

  const setSleepTimer = useCallback(
    (minutes: number | null) => {
      setSleepTimerMinLeft(minutes);
      if (minutes !== null) {
        showToast(`Sleep timer set for ${minutes} minute(s)`);
      } else {
        showToast('Sleep timer cancelled');
      }
    },
    [showToast],
  );

  // Navigation with Back/Forward stack
  const navigate = useCallback(
    (route: ScreenRoute, param?: string) => {
      setNavHistory((prev) => {
        const curr = prev[navIndex];
        if (curr && curr.route === route && curr.param === param) {
          return prev;
        }
        const truncated = prev.slice(0, navIndex + 1);
        const next = [...truncated, { route, param }];
        setNavIndex(next.length - 1);
        return next;
      });
    },
    [navIndex],
  );

  const goBack = useCallback(() => {
    setNavIndex((idx) => Math.max(0, idx - 1));
  }, []);

  const goForward = useCallback(() => {
    setNavIndex((idx) => Math.min(navHistory.length - 1, idx + 1));
  }, [navHistory.length]);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  // Fetch clean InnerTube Home Feed via ytmClient
  useEffect(() => {
    let cancelled = false;
    let retryTimer: NodeJS.Timeout | null = null;
    setHomeLoading(true);

    const fetchHome = async (attempt = 0): Promise<void> => {
      if (cancelled) return;

      // Wait for both proxy config and auth status to be ready
      if (!proxyReady || ytAuthStatus === null) {
        setHomeLoading(false);
        return;
      }

      if (!settings.ytMusicEnabled) {
        setHomeTracks(tracks.slice(0, 24));
        setHomeSections([]);
        setHomeChips([]);
        setHomeSourceLabel('Local Library');
        setHomeLoading(false);
        return;
      }

      try {
        const data = await ytmClient.getHomeFeed({
          params: selectedHomeChipParams || undefined,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        });
        if (!cancelled) {
          setHomeSections(data.sections || []);
          if (!selectedHomeChipParams && data.chips && data.chips.length > 0) {
            setHomeChips(data.chips);
          }
          setHomeTracks(data.tracks || []);
          setHomeSourceLabel(
            ytAuthStatus?.loggedIn ? 'YouTube Music (Personalized)' : 'YouTube Music',
          );
          setHomeLoading(false);
        }
      } catch (err) {
        if (!cancelled && attempt < 2) {
          // Retry after a short delay to allow the YTM vault / safeStorage to
          // finish decrypting on Windows, which can lag behind auth restore.
          retryTimer = setTimeout(() => {
            void fetchHome(attempt + 1);
          }, 2000);
        } else if (!cancelled) {
          setHomeSections([]);
          setHomeTracks([]);
          setHomeLoading(false);
        }
      }
    };

    void fetchHome();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    proxyReady,
    ytAuthStatus,
    selectedHomeChipParams,
    settings.contentLanguage,
    settings.contentRegion,
    settings.ytMusicEnabled,
    tracks,
  ]);

  const openYtMusicBrowse = useCallback(
    async (browseId: string, titleHint = 'YouTube Music Collection', params?: string) => {
      const cleanId = browseId.trim();
      if (!cleanId) return;
      void params;
      navigate('playlist', `ytbrowse:${cleanId}`);
      setBrowsedCollections((prev) => ({
        ...prev,
        [cleanId]: {
          title: prev[cleanId]?.title || titleHint,
          subtitle: prev[cleanId]?.subtitle || 'Loading from YouTube Music...',
          tracks: prev[cleanId]?.tracks || [],
          cards: prev[cleanId]?.cards || [],
          loading: true,
        },
      }));
      try {
        const data = await ytmClient.browseCollection({
          browseId: cleanId,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        });
        setBrowsedCollections((prev) => ({
          ...prev,
          [cleanId]: {
            title: data.title || titleHint,
            subtitle: data.subtitle || `${(data.tracks || []).length} track(s)`,
            tracks: data.tracks || [],
            cards: data.items || [],
            loading: false,
          },
        }));
      } catch {
        setBrowsedCollections((prev) => ({
          ...prev,
          [cleanId]: {
            title: titleHint,
            subtitle: 'Could not load this YouTube Music item.',
            tracks: [],
            cards: [],
            loading: false,
          },
        }));
      }
    },
    [navigate, settings.contentLanguage, settings.contentRegion],
  );

  const loadCharts = useCallback(async () => {
    if (!proxyReady) return;
    setChartsLoading(true);
    try {
      const data = await ytmClient.getCharts(
        settings.contentRegion || 'US',
        settings.contentLanguage || 'en',
      );
      setChartsTracks(data.tracks || []);
    } catch {
      // silent
    } finally {
      setChartsLoading(false);
    }
  }, [proxyReady, settings.contentLanguage, settings.contentRegion]);

  useEffect(() => {
    void loadCharts();
  }, [loadCharts, proxyReady]);

  // Theme application
  useEffect(() => {
    const seed =
      settings.dynamicThemeFromArtwork && dynamicArtworkPrimary
        ? dynamicArtworkPrimary
        : settings.themeColor;
    applyMaterialTheme(seed, settings.darkMode, settings.pureBlack, settings.themeSurfaceStyle);
  }, [
    settings.darkMode,
    settings.pureBlack,
    settings.themeSurfaceStyle,
    settings.themeColor,
    settings.dynamicThemeFromArtwork,
    dynamicArtworkPrimary,
  ]);

  useEffect(() => {
    if (!currentTrack || !settings.dynamicThemeFromArtwork) {
      setDynamicArtworkPrimary(null);
      return;
    }
    let cancelled = false;
    extractPaletteFromArtwork(currentTrack.thumbnailUrl, currentTrack.accentHex || settings.themeColor)
      .then((palette) => {
        if (!cancelled) {
          setDynamicArtworkPrimary(palette.primary);
          setDynamicArtworkSecondary(palette.secondary);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentTrack, settings.dynamicThemeFromArtwork, settings.themeColor]);

  const activeEq = useMemo(
    () => eqState.profiles.find((p) => p.id === eqState.activeId) || eqState.profiles[0],
    [eqState],
  );

  // Sync audio DSP parameters
  useEffect(() => {
    audioEngine.setVolume(settings.volume);
    audioEngine.setPlaybackSpeed(settings.playbackSpeed);
    audioEngine.setPreservePitch(settings.preservePitch);
    audioEngine.setNormalizeLoudness(settings.normalizeLoudness);
    audioEngine.setCrossfadeSec(settings.crossfadeSec);
  }, [
    settings.volume,
    settings.playbackSpeed,
    settings.preservePitch,
    settings.normalizeLoudness,
    settings.crossfadeSec,
  ]);

  useEffect(() => {
    if (activeEq) {
      audioEngine.applyEq(activeEq);
    }
  }, [activeEq]);

  // Fetch synced lyrics (LRCLIB + YouTube Music fallback) + optional translation
  const fetchLyricsForTrack = useCallback(
    async (track: Track) => {
      setActiveTrackLyrics({
        syncedLyrics: track.syncedLyrics || null,
        plainLyrics: track.plainLyrics || null,
        translations: [],
        source: null,
        loading: !(track.syncedLyrics || track.plainLyrics),
      });

      let synced = track.syncedLyrics || null;
      let plain = track.plainLyrics || null;
      let source: string | null = synced || plain ? 'Cached' : null;

      if (!synced && !plain) {
        try {
          const data = await ytmClient.getLyrics({
            title: track.title,
            artist: track.artist,
            videoId: track.ytMusicVideoId,
            lyricsBrowseId: queueNextResult?.lyricsBrowseId,
            gl: settings.contentRegion || 'US',
            hl: settings.contentLanguage || 'en',
          });
          synced = data.syncedLyrics || null;
          plain = data.plainLyrics || null;
          source = data.source || null;
        } catch {
          // ignore
        }
      }

      let translations: string[] = [];
      if (settings.showSyncedLyricsTranslation && synced) {
        const parsed = parseLrcLyrics(synced);
        if (parsed.length > 0) {
          try {
            const targetIso = LANG_ISO_MAP[settings.translationLanguage] || 'en';
            const trRes = await apiFetch('/api/translate-lyrics', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lines: parsed.map((l) => l.text),
                targetLang: targetIso,
              }),
            });
            if (trRes.ok) {
              const trJson = (await trRes.json()) as { translations?: string[] };
              translations = trJson.translations || [];
            }
          } catch {
            translations = [];
          }
        }
      }

      setActiveTrackLyrics({
        syncedLyrics: synced,
        plainLyrics: plain,
        translations,
        source,
        loading: false,
      });
    },
    [
      queueNextResult?.lyricsBrowseId,
      settings.contentLanguage,
      settings.contentRegion,
      settings.showSyncedLyricsTranslation,
      settings.translationLanguage,
    ],
  );

  useEffect(() => {
    if (!currentTrack) {
      setActiveTrackLyrics({
        syncedLyrics: null,
        plainLyrics: null,
        translations: [],
        source: null,
        loading: false,
      });
      return;
    }
    void fetchLyricsForTrack(currentTrack);
  }, [currentTrack, fetchLyricsForTrack]);

  const refreshCurrentLyrics = useCallback(async () => {
    if (currentTrack) {
      await fetchLyricsForTrack(currentTrack);
    }
  }, [currentTrack, fetchLyricsForTrack]);

  const ensureTrackInStore = useCallback((track: Track) => {
    setTracks((prev) => {
      const exists = prev.find((t) => t.id === track.id);
      if (exists) return prev;
      return [track, ...prev];
    });
  }, []);

  const logPlayEvent = useCallback(
    (track: Track) => {
      if (!settings.pauseListenHistory) {
        const evt: PlayEvent = {
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          thumbnailUrl: track.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL,
          timestamp: Date.now(),
          durationPlayedSec: track.durationSec || 30,
        };
        setPlayEvents((prev) => [evt, ...prev].slice(0, 500));
      }
      if (settings.listenBrainzToken.trim()) {
        void apiFetch('/api/scrobble', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: track.title,
            artist: track.artist,
            album: track.album,
            listenBrainzToken: settings.listenBrainzToken.trim(),
          }),
        }).catch(() => undefined);
      }
    },
    [settings.listenBrainzToken, settings.pauseListenHistory],
  );

  const sponsorSegmentsRef = useRef<SponsorBlockSegment[]>([]);
  const skippedSegmentsRef = useRef<Set<string>>(new Set());

  // Limitless YouTube Music "Up Next" queue suggestions (Radio + Chips + Continuations)
  const fetchQueueNext = useCallback(
    async (
      videoId?: string,
      playlistId?: string,
      params?: string,
      followAutomixPreview = true,
      options?: { replaceUpcoming?: boolean; title?: string; artist?: string },
    ): Promise<Track[]> => {
      let targetVid = videoId;
      if (!targetVid && !playlistId && options?.title) {
        const searchRes = await ytmClient
          .searchYtm({
            query: `${options.artist ? `${options.artist} ` : ''}${options.title}`.trim(),
            filter: 'songs',
            gl: settings.contentRegion || 'US',
            hl: settings.contentLanguage || 'en',
          })
          .catch(() => null);
        targetVid = searchRes?.tracks?.[0]?.ytMusicVideoId;
      }

      if (!targetVid && !playlistId) return [];
      void followAutomixPreview;

      setQueueNextLoading(true);
      try {
        const data = await ytmClient.getQueueNext({
          videoId: targetVid,
          playlistId,
          params,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        });
        if (!data) return [];
        setQueueNextResult(data);

        const incoming = data.items || [];
        if (incoming.length > 0) {
          setQueue((prev) =>
            options?.replaceUpcoming
              ? replaceUpcomingQueueWithRadio(prev, queueIndexRef.current, incoming)
              : appendUniqueQueueSuggestions(prev, incoming),
          );
        }
        return incoming;
      } catch {
        return [];
      } finally {
        setQueueNextLoading(false);
      }
    },
    [settings.contentLanguage, settings.contentRegion],
  );

  useEffect(() => {
    fetchQueueNextRef.current = fetchQueueNext;
  }, [fetchQueueNext]);

  const loadMoreQueueNext = useCallback(async (): Promise<Track[]> => {
    if (queueNextLoading) return [];
    const currentCont = queueNextResult?.continuation;

    if (!currentCont) {
      const seed = queueRef.current[queueRef.current.length - 1] || currentTrack;
      if (!seed) return [];
      return await fetchQueueNext(seed.ytMusicVideoId, undefined, undefined, true, {
        title: seed.title,
        artist: seed.artist,
      });
    }

    setQueueNextLoading(true);
    try {
      const data = await ytmClient.getQueueNext({
        continuation: currentCont,
        gl: settings.contentRegion || 'US',
        hl: settings.contentLanguage || 'en',
      });
      if (!data) return [];
      const newItems = data.items || [];
      setQueueNextResult((prev) => {
        if (!prev) return data;
        return {
          ...prev,
          continuation: data.continuation,
          items: appendUniqueQueueSuggestions(prev.items, newItems),
        };
      });
      if (newItems.length > 0) {
        setQueue((prev) => appendUniqueQueueSuggestions(prev, newItems));
      }
      return newItems;
    } catch {
      return [];
    } finally {
      setQueueNextLoading(false);
    }
  }, [
    currentTrack,
    fetchQueueNext,
    queueNextLoading,
    queueNextResult,
    settings.contentLanguage,
    settings.contentRegion,
  ]);

  useEffect(() => {
    loadMoreQueueNextRef.current = loadMoreQueueNext;
  }, [loadMoreQueueNext]);

  const toggleQueueChip = useCallback(
    async (chipId: string) => {
      const chip = queueNextResult?.queueChips.find((c) => c.id === chipId);
      if (!chip) return;

      const endpoint =
        chip.selected && chip.deselectEndpoint ? chip.deselectEndpoint : chip.endpoint;
      if (!endpoint?.watchEndpoint) return;

      const { videoId, playlistId, params } = endpoint.watchEndpoint;
      await fetchQueueNext(videoId || currentTrack?.ytMusicVideoId, playlistId, params, false, {
        replaceUpcoming: true,
        title: currentTrack?.title,
        artist: currentTrack?.artist,
      });
    },
    [currentTrack, fetchQueueNext, queueNextResult],
  );

const playTrack = useCallback(
    async (track: Track, newQueue?: Track[]) => {
      let resolvedTrack = track;
      if (track.source === 'plugin' && !track.streamUrl && track.pluginId) {
        const plugin = plugins.find((p) => p.id === track.pluginId);
        if (plugin) {
          try {
            const url = await resolveArchPluginStream(plugin, track.id);
            if (url) {
              resolvedTrack = { ...track, streamUrl: url };
            }
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Plugin stream lookup failed', 'error');
          }
        }
      }

      // Match archivetunepc: if streamUrl is /api/ytmusic/stream, add gl/hl/quality params
      if (resolvedTrack.streamUrl.startsWith('/api/ytmusic/stream')) {
        const streamUrlObj = new URL(resolvedTrack.streamUrl, window.location.origin);
        streamUrlObj.searchParams.set('gl', settings.contentRegion || 'US');
        streamUrlObj.searchParams.set('hl', settings.contentLanguage || 'en');
        streamUrlObj.searchParams.set('quality', settings.preferredAudioQuality || 'HIGH');
        resolvedTrack = {
          ...resolvedTrack,
          streamUrl: `${streamUrlObj.pathname}${streamUrlObj.search}`,
        };
      }

      sponsorSegmentsRef.current = [];
      skippedSegmentsRef.current.clear();
      if (settings.sponsorBlockEnabled && resolvedTrack.ytMusicVideoId) {
        const vid = resolvedTrack.ytMusicVideoId;
        void ytmClient.getSponsorBlock(vid).then((segments) => {
          if (segments.length > 0) {
            sponsorSegmentsRef.current = segments;
          }
        });
      }

      ensureTrackInStore(resolvedTrack);

      let activeIdx = 0;
      let resolvedQueueSnapshot: Track[] = [resolvedTrack];
      if (newQueue && newQueue.length > 0) {
        const foundIdx = newQueue.findIndex((t) => t.id === resolvedTrack.id);
        activeIdx = foundIdx >= 0 ? foundIdx : 0;
        resolvedQueueSnapshot = newQueue.map((t, i) => (i === activeIdx ? resolvedTrack : t));
        setQueue(resolvedQueueSnapshot);
        setQueueIndex(activeIdx);
      } else {
        setQueue((prev) => {
          const existingIdx = prev.findIndex((t) => t.id === resolvedTrack.id);
          if (existingIdx >= 0) {
            const copy = [...prev];
            copy[existingIdx] = resolvedTrack;
            resolvedQueueSnapshot = copy;
            setQueueIndex(existingIdx);
            return copy;
          }
          const copy = [resolvedTrack, ...prev];
          resolvedQueueSnapshot = copy;
          setQueueIndex(0);
          return copy;
        });
      }

      setCurrentTrack(resolvedTrack);
      setPositionSec(0);
      setDurationSec(resolvedTrack.durationSec || 0);

      audioEngine.stopImmediate();
      setIsPlaying(false);

      let started = false;
      let failureDetail = '';

      try {
        if (resolvedTrack.source === 'local') {
          started = await audioEngine.loadAndPlay(resolvedTrack.streamUrl);
          if (!started) {
            failureDetail = 'Local audio file could not be decoded.';
          }
        } else {
          // For all other sources (ytmusic, online, etc.), use streamUrl directly
          // The /api/ytmusic/stream endpoint handles resolution + proxying
          started = await audioEngine.loadAndPlay(resolvedTrack.streamUrl);
          if (!started) {
            failureDetail = `Audio playback error (${audioEngine.lastPlayError || 'unknown'})`;
          }
        }
      } catch (err) {
        failureDetail = err instanceof Error ? err.message : String(err);
      }

      setIsPlaying(started);
      if (started) {
        logPlayEvent(resolvedTrack);

        // Fetch YouTube Music "Up Next" queue for YT Music tracks
        if (resolvedTrack.source === 'ytmusic' && resolvedTrack.ytMusicVideoId) {
          void fetchQueueNextRef.current?.(
            resolvedTrack.ytMusicVideoId,
            undefined,
            undefined,
            true,
            { title: resolvedTrack.title, artist: resolvedTrack.artist },
          );
        }
      } else {
        showToast(
          failureDetail
            ? `Could not play "${resolvedTrack.title}": ${failureDetail}`
            : `Could not resolve an audio stream for "${resolvedTrack.title}".`,
          'error',
        );
      }
    },
    [
      ensureTrackInStore,
      logPlayEvent,
      plugins,
      settings.contentLanguage,
      settings.contentRegion,
      settings.preferredAudioQuality,
      settings.sponsorBlockEnabled,
      showToast,
    ],
  );

  // Auto-prefetch next radio page when user reaches within 3 tracks of queue end
  useEffect(() => {
    if (!currentTrack || queue.length === 0) return;
    if (queueIndex >= Math.max(0, queue.length - 3) && queueNextResult?.continuation && !queueNextLoading) {
      void loadMoreQueueNextRef.current?.();
    }
  }, [currentTrack, queue.length, queueIndex, queueNextLoading, queueNextResult?.continuation]);

  const nextTrack = useCallback(async () => {
    const activeQueue = queueRef.current;
    const activeIdx = queueIndexRef.current;
    if (activeQueue.length === 0) return;
    if (repeatMode === 'ONE' && currentTrack) {
      audioEngine.seek(0);
      await audioEngine.play();
      setIsPlaying(true);
      return;
    }

    let nextIdx = activeIdx + 1;
    if (shuffleEnabled && activeQueue.length > 1) {
      let randIdx = Math.floor(Math.random() * activeQueue.length);
      if (randIdx === activeIdx) randIdx = (activeIdx + 1) % activeQueue.length;
      nextIdx = randIdx;
    } else if (nextIdx >= activeQueue.length) {
      if (repeatMode === 'ALL') {
        nextIdx = 0;
      } else {
        const more = await loadMoreQueueNextRef.current?.();
        if (more && more.length > 0) {
          const refreshedQueue = queueRef.current;
          const targetNext = refreshedQueue[activeIdx + 1] || more[0];
          if (targetNext) {
            setQueueIndex(activeIdx + 1);
            await playTrack(targetNext, refreshedQueue);
            return;
          }
        }
        setIsPlaying(false);
        return;
      }
    }

    const target = activeQueue[nextIdx];
    if (target) {
      setQueueIndex(nextIdx);
      await playTrack(target, activeQueue);
    }
  }, [currentTrack, playTrack, repeatMode, shuffleEnabled]);

  const prevTrack = useCallback(async () => {
    if (positionSec > 3) {
      audioEngine.seek(0);
      setPositionSec(0);
      return;
    }
    const activeQueue = queueRef.current;
    if (activeQueue.length === 0) return;
    const prevIdx = queueIndexRef.current - 1 < 0 ? activeQueue.length - 1 : queueIndexRef.current - 1;
    const target = activeQueue[prevIdx];
    if (target) {
      setQueueIndex(prevIdx);
      await playTrack(target, activeQueue);
    }
  }, [playTrack, positionSec]);

  useEffect(() => {
    audioEngine.onTimeUpdate = (pos, dur) => {
      if (settings.sponsorBlockEnabled && sponsorSegmentsRef.current.length > 0) {
        const hit = sponsorSegmentsRef.current.find(
          (seg) =>
            pos >= seg.startSec &&
            pos < seg.endSec - 0.6 &&
            !skippedSegmentsRef.current.has(`${seg.startSec}-${seg.endSec}`),
        );
        if (hit) {
          skippedSegmentsRef.current.add(`${hit.startSec}-${hit.endSec}`);
          audioEngine.seek(hit.endSec);
          setPositionSec(hit.endSec);
          showToast(`Skipped ${hit.category.replace(/_/g, ' ')} segment (SponsorBlock)`);
          return;
        }
      }
      setPositionSec(pos);
      if (dur > 0) setDurationSec(dur);
    };

    audioEngine.onEnded = () => {
      void nextTrack();
    };

    audioEngine.onError = (msg) => {
      setIsPlaying(false);
      showToast(msg, 'error');
    };
  }, [
    nextTrack,
    settings.sponsorBlockEnabled,
    showToast,
  ]);

  const togglePlayPause = useCallback(async () => {
    if (!currentTrack) {
      const first = homeTracks[0] || tracks[0];
      if (first) {
        await playTrack(first, homeTracks.length ? homeTracks : tracks);
      }
      return;
    }
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    } else if (audioEngine.getCurrentTime() === 0 && !audioEngine.isPlaying()) {
      await playTrack(currentTrack, queueRef.current);
    } else {
      await audioEngine.play();
      setIsPlaying(true);
    }
  }, [currentTrack, homeTracks, isPlaying, playTrack, tracks]);

  const seekTo = useCallback((sec: number) => {
    audioEngine.seek(sec);
    setPositionSec(sec);
  }, []);

  const playNext = useCallback(
    (track: Track) => {
      ensureTrackInStore(track);
      setQueue((prev) => {
        if (prev.length === 0) {
          setQueueIndex(0);
          return [track];
        }
        const filtered = prev.filter((t, i) => !(t.id === track.id && i !== queueIndexRef.current));
        const insertAt = Math.min(queueIndexRef.current + 1, filtered.length);
        const copy = [...filtered];
        copy.splice(insertAt, 0, track);
        return copy;
      });
      showToast(`"${track.title}" will play next`);
    },
    [ensureTrackInStore, showToast],
  );

  const addToQueue = useCallback(
    (track: Track) => {
      ensureTrackInStore(track);
      setQueue((prev) => {
        if (prev.some((t) => t.id === track.id)) return prev;
        return [...prev, track];
      });
      showToast(`Added "${track.title}" to queue`);
    },
    [ensureTrackInStore, showToast],
  );

  const moveQueueItem = useCallback((fromIdx: number, toIdx: number) => {
    setQueue((prev) => {
      if (fromIdx < 0 || toIdx < 0 || fromIdx >= prev.length || toIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  }, []);

  const removeQueueItem = useCallback((idx: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue((prev) => (currentTrack ? prev.filter((t) => t.id === currentTrack.id) : []));
    setQueueIndex(0);
  }, [currentTrack]);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((m) => (m === 'OFF' ? 'ALL' : m === 'ALL' ? 'ONE' : 'OFF'));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((s) => !s);
  }, []);

  const isTrackLiked = useCallback(
    (trackId: string) => {
      const likedPlaylist = playlists.find((p) => p.id === 'pl-liked');
      if (likedPlaylist) return likedPlaylist.trackIds.includes(trackId);
      return Boolean(tracks.find((t) => t.id === trackId)?.liked);
    },
    [playlists, tracks],
  );

  const toggleLike = useCallback(
    (trackId: string, trackData?: Track) => {
      if (trackData) {
        ensureTrackInStore(trackData);
      }
      const currentlyLiked = isTrackLiked(trackId);
      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, liked: !currentlyLiked } : t)),
      );
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== 'pl-liked') return pl;
          const exists = pl.trackIds.includes(trackId);
          return {
            ...pl,
            trackIds: exists
              ? pl.trackIds.filter((id) => id !== trackId)
              : [trackId, ...pl.trackIds],
          };
        }),
      );
      setCurrentTrack((curr) => (curr?.id === trackId ? { ...curr, liked: !currentlyLiked } : curr));

      const targetVideoId =
        trackData?.ytMusicVideoId ||
        tracks.find((t) => t.id === trackId)?.ytMusicVideoId ||
        (currentTrack?.id === trackId ? currentTrack.ytMusicVideoId : undefined);
      if (ytAuthStatus?.loggedIn && targetVideoId) {
        void ytmClient
          .likeYtmTrack(
            targetVideoId,
            !currentlyLiked,
            settings.contentRegion || 'US',
            settings.contentLanguage || 'en',
          )
          .catch(() => undefined);
      }
    },
    [
      currentTrack,
      ensureTrackInStore,
      isTrackLiked,
      settings.contentLanguage,
      settings.contentRegion,
      tracks,
      ytAuthStatus?.loggedIn,
    ],
  );

  const createPlaylist = useCallback(
    (name: string, description = '', initialTracks: Track[] = []): Playlist => {
      initialTracks.forEach((t) => ensureTrackInStore(t));
      const newPl: Playlist = {
        id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim() || 'Untitled Playlist',
        description: description.trim(),
        trackIds: initialTracks.map((t) => t.id),
        tagIds: [],
        coverUrl: initialTracks[0]?.thumbnailUrl,
        createdAt: Date.now(),
      };
      setPlaylists((prev) => [newPl, ...prev]);
      showToast(`Created playlist "${newPl.name}"`);
      return newPl;
    },
    [ensureTrackInStore, showToast],
  );

  const addTrackToPlaylist = useCallback(
    (playlistId: string, track: Track) => {
      ensureTrackInStore(track);
      const targetPl = playlists.find((pl) => pl.id === playlistId);
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          if (pl.trackIds.includes(track.id)) return pl;
          return {
            ...pl,
            coverUrl: pl.coverUrl || track.thumbnailUrl,
            trackIds: [...pl.trackIds, track.id],
          };
        }),
      );
      if (ytAuthStatus?.loggedIn && targetPl?.ytBrowseId && track.ytMusicVideoId) {
        void apiFetch('/api/ytmusic/edit-playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playlistId: targetPl.ytBrowseId,
            videoId: track.ytMusicVideoId,
            gl: settings.contentRegion || 'US',
            hl: settings.contentLanguage || 'en',
          }),
        }).catch(() => undefined);
      }
      showToast(`Added "${track.title}" to playlist`);
    },
    [
      ensureTrackInStore,
      playlists,
      settings.contentLanguage,
      settings.contentRegion,
      showToast,
      ytAuthStatus?.loggedIn,
    ],
  );

  const removeTrackFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId
          ? { ...pl, trackIds: pl.trackIds.filter((id) => id !== trackId) }
          : pl,
      ),
    );
  }, []);

  const deletePlaylist = useCallback(
    (playlistId: string) => {
      const target = playlists.find((p) => p.id === playlistId);
      if (!target || target.isSystem) return;
      setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
      showToast(`Deleted playlist "${target.name}"`);
      if (currentView.route === 'playlist' && currentView.param === playlistId) {
        navigate('library');
      }
    },
    [currentView.param, currentView.route, navigate, playlists, showToast],
  );

  const exportPlaylistM3u = useCallback(
    (playlistId: string) => {
      const pl = playlists.find((p) => p.id === playlistId);
      if (!pl) return;
      const lines = ['#EXTM3U', `#PLAYLIST:${pl.name}`];
      for (const id of pl.trackIds) {
        const t = tracks.find((item) => item.id === id);
        if (t) {
          lines.push(`#EXTINF:${Math.round(t.durationSec || 180)},${t.artist} - ${t.title}`);
          lines.push(t.streamUrl || t.ytMusicVideoId || t.title);
        }
      }
      const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pl.name.replace(/[^a-z0-9_-]+/gi, '_')}.m3u`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Exported "${pl.name}.m3u"`);
    },
    [playlists, showToast, tracks],
  );

  const applySyncedYtLibraryPayload = useCallback(
    (data: {
      likedTracks?: Track[];
      playlists?: Array<{
        browseId: string;
        playlistId?: string;
        title: string;
        subtitle?: string;
        thumbnailUrl?: string;
        tracks?: Track[];
      }>;
      savedAlbums?: YtMusicBrowseItem[];
      followedArtists?: YtMusicBrowseItem[];
      uploadedTracks?: Track[];
      historyTracks?: Track[];
      syncedAt?: number;
    }) => {
      const liked = (data.likedTracks || []).map((t) => ({ ...t, liked: true }));
      const uploads = data.uploadedTracks || [];
      const history = data.historyTracks || [];
      const cloudPls = data.playlists || [];

      const allToStore: Track[] = [...liked, ...uploads, ...history];
      for (const cpl of cloudPls) {
        if (cpl.tracks?.length) allToStore.push(...cpl.tracks);
      }

      if (allToStore.length > 0) {
        setTracks((prev) => {
          const map = new Map(prev.map((t) => [t.id, t]));
          for (const t of allToStore) {
            const existing = map.get(t.id);
            map.set(t.id, existing ? { ...existing, ...t } : t);
          }
          return Array.from(map.values());
        });
      }

      setPlaylists((prev) => {
        let hasLiked = false;
        let next = prev.map((pl) => {
          if (pl.id !== 'pl-liked') return pl;
          hasLiked = true;
          return {
            ...pl,
            trackIds: Array.from(new Set([...liked.map((t) => t.id), ...pl.trackIds])),
          };
        });

        if (!hasLiked && liked.length > 0) {
          next.unshift({
            id: 'pl-liked',
            name: 'Liked Songs',
            description: 'Your favorite tracks synced from YouTube Music',
            trackIds: liked.map((t) => t.id),
            tagIds: [],
            coverUrl: liked[0]?.thumbnailUrl,
            createdAt: Date.now(),
            isSystem: true,
          });
        }

        for (const cpl of cloudPls) {
          const id = `ytpl-${cpl.browseId}`;
          const trackIds = (cpl.tracks || []).map((t) => t.id);
          const existing = next.find((p) => p.id === id);
          if (existing) {
            next = next.map((p) =>
              p.id === id
                ? {
                    ...p,
                    name: cpl.title || p.name,
                    coverUrl: cpl.thumbnailUrl || p.coverUrl,
                    trackIds: trackIds.length > 0 ? trackIds : p.trackIds,
                    ytBrowseId: cpl.browseId,
                    ytPlaylistId: cpl.playlistId,
                  }
                : p,
            );
          } else {
            next = [
              ...next,
              {
                id,
                name: cpl.title || 'YouTube Music Playlist',
                description: cpl.subtitle || 'Synced from YouTube Music',
                trackIds,
                tagIds: [],
                coverUrl: cpl.thumbnailUrl || cpl.tracks?.[0]?.thumbnailUrl,
                createdAt: Date.now(),
                ytBrowseId: cpl.browseId,
                ytPlaylistId: cpl.playlistId,
              },
            ];
          }
        }
        return next;
      });

      if (data.savedAlbums) setYtSavedAlbums(data.savedAlbums);
      if (data.followedArtists) setYtFollowedArtists(data.followedArtists);
      if (data.uploadedTracks) setYtUploadedTracks(data.uploadedTracks);
      if (data.historyTracks) setYtHistoryTracks(data.historyTracks);
      if (data.syncedAt) setLastLibrarySyncAt(data.syncedAt);
    },
    [],
  );

  const syncYtMusicLibrary = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const data = await ytmClient.syncYtmLibrary(
        settings.contentRegion || 'US',
        settings.contentLanguage || 'en',
      );
      if (!data.ok) {
        return { ok: false, message: data.error || 'Library sync failed.' };
      }
      applySyncedYtLibraryPayload(data);
      const liked = data.likedTracks?.length || 0;
      const pls = data.playlists?.length || 0;
      const albums = data.savedAlbums?.length || 0;
      showToast(`Synced ${liked} liked songs, ${pls} playlists, ${albums} albums`);
      return {
        ok: true,
        message: `Synced ${liked} liked tracks, ${pls} playlists, and ${albums} albums.`,
      };
    } catch {
      return { ok: false, message: 'Library sync failed due to network error.' };
    }
  }, [
    applySyncedYtLibraryPayload,
    settings.contentLanguage,
    settings.contentRegion,
    showToast,
  ]);

  useEffect(() => {
    syncYtMusicLibraryRef.current = syncYtMusicLibrary;
  }, [syncYtMusicLibrary]);

  const signInWithYouTubeMusic = useCallback(
    async (options?: {
      cleanPartition?: boolean;
    }): Promise<{
      ok: boolean;
      blocked?: boolean;
      cancelled?: boolean;
      message: string;
    }> => {
      setSigningInYtMusic(true);
      setYtLoginError(null);
      try {
        const res = await ytmClient.loginYtm(options);
        if (res.status) {
          setYtAuthStatus(res.status);
        }
        if (res.cancelled) {
          // User closed the login window (X or Cancel). Reset to "Sign in"
          // without showing an error; signingInYtMusic is reset in finally.
          return { ok: false, cancelled: true, message: '' };
        }
        if (!res.ok) {
          const msg = res.error || 'YouTube Music sign-in did not complete.';
          setYtLoginError(msg);
          if (!msg.toLowerCase().includes('closed')) {
            showToast(msg, 'error');
          }
          return { ok: false, blocked: res.blocked, message: msg };
        }

        const name = res.status?.accountName || 'YouTube Music User';
        setYtLoginError(null);
        showToast(`Signed in to YouTube Music as ${name}. Syncing library...`);
        // Persist auth status to localStorage backup immediately after sign-in.
        // This ensures the user stays signed in across app restarts even if
        // safeStorage vault decryption fails on Windows.
        if (res.status) {
          try {
            localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(res.status));
          } catch {
            // ignore
          }
        }
        await syncYtMusicLibraryRef.current?.();
        return { ok: true, message: `Signed in as ${name}` };
      } catch {
        const msg = 'Could not open YouTube Music sign-in.';
        setYtLoginError(msg);
        showToast(msg, 'error');
        return { ok: false, message: msg };
      } finally {
        setSigningInYtMusic(false);
      }
    },
    [showToast],
  );

  const cancelYtMusicSignIn = useCallback(async () => {
    await ytmClient.ytmCancel();
  }, []);

  const importYtmBrowserSession = useCallback(
    async (payload: {
      cookieHeader: string;
      visitorData?: string;
      dataSyncId?: string;
      accountIndex?: number;
    }): Promise<{ ok: boolean; message: string }> => {
      setSigningInYtMusic(true);
      try {
        const res = await ytmClient.importYtmBrowserSession(payload);
        if (!res.ok || !res.status) {
          const msg = res.error || 'Could not validate YouTube Music session.';
          showToast(msg, 'error');
          return { ok: false, message: msg };
        }
        setYtAuthStatus(res.status);
        // Persist auth status to localStorage backup after browser session import.
        if (res.status) {
          try {
            localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(res.status));
          } catch {
            // ignore
          }
        }
        showToast(`Signed in as ${res.status.accountName}. Syncing library...`);
        await syncYtMusicLibraryRef.current?.();
        return { ok: true, message: `Signed in as ${res.status.accountName}` };
      } catch {
        return { ok: false, message: 'Failed to import browser session.' };
      } finally {
        setSigningInYtMusic(false);
      }
    },
    [showToast],
  );

  const switchYtAccount = useCallback(
    async (accountId: string) => {
      const nextStatus = await ytmClient.switchYtmAccount(accountId);
      setYtAuthStatus(nextStatus);
      // Persist auth status to localStorage backup after account switch.
      if (nextStatus.loggedIn) {
        try {
          localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(nextStatus));
        } catch {
          // ignore
        }
      } else {
        try {
          localStorage.removeItem(YT_AUTH_LOCAL_KEY);
        } catch {
          // ignore
        }
      }
      showToast(`Switched to ${nextStatus.accountName || 'YouTube Music account'}`);
      await syncYtMusicLibraryRef.current?.();
    },
    [showToast],
  );

  const signOutYtAccount = useCallback(
    async (accountId?: string) => {
      const nextStatus = await ytmClient.logoutYtmAccount(accountId);
      setYtAuthStatus(nextStatus);
      // Clear localStorage auth backup on sign-out.
      try {
        localStorage.removeItem('ririp_c_yt_auth_v1');
      } catch {
        // ignore
      }
      if (!nextStatus.loggedIn) {
        setYtSavedAlbums([]);
        setYtFollowedArtists([]);
        setYtUploadedTracks([]);
        setYtHistoryTracks([]);
        setPlaylists((prev) => prev.filter((p) => !p.ytBrowseId));
      } else {
        await syncYtMusicLibraryRef.current?.();
      }
      showToast(nextStatus.loggedIn ? `Switched to ${nextStatus.accountName}` : 'Signed out of YouTube Music');
    },
    [showToast],
  );

  // Import playlists via YouTube Music InnerTube browse or Spotify matcher
  const importYtMusicPlaylist = useCallback(
    async (input: string) => {
      const browseId = extractYtmBrowseIdFromInput(input);
      if (!browseId) {
        return {
          ok: false,
          message: 'Enter a valid YouTube Music playlist URL or PL.../VL... playlist ID.',
        };
      }
      try {
        const data = await ytmClient.browseCollection({
          browseId,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        });
        const imported = data.tracks || [];
        if (imported.length === 0) {
          return {
            ok: false,
            message:
              'No tracks returned for this playlist. Check the URL or sign in to YouTube Music if private.',
          };
        }
        const pl = createPlaylist(
          data.title || 'YouTube Music Playlist',
          `Imported from YouTube Music (${imported.length} tracks)`,
          imported,
        );
        return {
          ok: true,
          message: `Imported ${imported.length} tracks into "${pl.name}".`,
          playlistId: pl.id,
        };
      } catch {
        return { ok: false, message: 'Network error while importing YouTube Music playlist.' };
      }
    },
    [createPlaylist, settings.contentLanguage, settings.contentRegion],
  );

  const importSpotifyPlaylist = useCallback(
    async (input: string) => {
      try {
        const data = await ytmClient.importSpotifyPlaylist(
          input,
          settings.contentRegion || 'US',
          settings.contentLanguage || 'en',
        );
        if (!data.ok) {
          return {
            ok: false,
            message: data.error || 'Spotify import failed.',
            unmatchedTracks: data.unmatchedTracks || [],
          };
        }
        if (data.unmatchedTracks?.length) {
          setSessionUnmatchedTracks((prev) => {
            const map = new Map(prev.map((u) => [u.id, u]));
            for (const item of data.unmatchedTracks) map.set(item.id, item);
            return Array.from(map.values());
          });
        }
        const imported = data.tracks || [];
        if (imported.length === 0) {
          return {
            ok: false,
            message:
              'No matching YouTube Music tracks found. Paste a Spotify playlist URL or "Artist - Track" lines.',
            unmatchedTracks: data.unmatchedTracks || [],
          };
        }
        const pl = createPlaylist(
          data.playlistName || 'Spotify Import',
          `Matched ${imported.length} track(s) on YouTube Music`,
          imported,
        );
        const unmatchedNote =
          data.unmatchedTracks?.length > 0
            ? ` (${data.unmatchedTracks.length} unmatched)`
            : '';
        return {
          ok: true,
          message: `Imported ${imported.length} tracks into "${pl.name}"${unmatchedNote}.`,
          playlistId: pl.id,
          unmatchedTracks: data.unmatchedTracks || [],
        };
      } catch {
        return { ok: false, message: 'Network error while importing Spotify playlist.' };
      }
    },
    [createPlaylist, settings.contentLanguage, settings.contentRegion],
  );

  // Spotify Library Sync (ArchiveTune sp_dc session + Pathfinder GQL -> YouTube Music matcher)
  const syncSpotifyLibraryWithConnection = useCallback(
    async (silent = false): Promise<{ ok: boolean; message: string }> => {
      if (spotifySyncing) return { ok: false, message: 'Spotify sync is already in progress.' };
      setSpotifySyncing(true);
      
      // Initialize progress
      setSpotifySyncProgress({
        phase: 'fetching',
        message: 'Connecting to Spotify...',
        completed: 0,
        total: 0,
        inProgress: true,
      });

      try {
        // Update progress: fetching liked songs
        setSpotifySyncProgress({
          phase: 'fetching',
          message: 'Fetching liked songs from Spotify...',
          completed: 0,
          total: 100,
          inProgress: true,
        });

        const data = await ytmClient.syncSpotify(
          settings.contentRegion || 'US',
          settings.contentLanguage || 'en',
        );
        
        if (data.connection) {
          setSpotifyConnection(data.connection);
        }
        if (!data.ok) {
          const msg = data.error || 'Spotify library sync failed.';
          setSpotifySyncProgress({
            phase: 'error',
            message: msg,
            completed: 0,
            total: 0,
            inProgress: false,
          });
          if (!silent) showToast(msg, 'error');
          return { ok: false, message: msg };
        }

        const liked = (data.likedTracks || []).map((t) => ({ ...t, liked: true }));
        const syncedPlaylists = data.playlists || [];
        
        // Update progress: matching tracks
        setSpotifySyncProgress({
          phase: 'matching',
          message: `Matching ${liked.length} liked songs on YouTube Music...`,
          completed: liked.length,
          total: liked.length,
          inProgress: true,
        });

        const allIncoming: Track[] = [...liked];
        for (const spPl of syncedPlaylists) {
          if (spPl.tracks?.length) allIncoming.push(...spPl.tracks);
        }

        // Update progress: importing playlists
        setSpotifySyncProgress({
          phase: 'importing',
          message: `Importing ${syncedPlaylists.length} playlists...`,
          completed: 0,
          total: syncedPlaylists.length,
          inProgress: true,
        });

        if (allIncoming.length > 0) {
          setTracks((prev) => {
            const map = new Map(prev.map((t) => [t.id, t]));
            for (const t of allIncoming) {
              const existing = map.get(t.id);
              map.set(t.id, existing ? { ...existing, ...t } : t);
            }
            return Array.from(map.values());
          });
        }

        setPlaylists((prev) => {
          let hasLiked = false;
          let next = prev.map((pl) => {
            if (pl.id !== 'pl-liked') return pl;
            hasLiked = true;
            return {
              ...pl,
              trackIds: Array.from(new Set([...liked.map((t) => t.id), ...pl.trackIds])),
            };
          });
          if (!hasLiked && liked.length > 0) {
            next.unshift({
              id: 'pl-liked',
              name: 'Liked Songs',
              description: 'Your favorite tracks synced into Riri Player',
              trackIds: liked.map((t) => t.id),
              tagIds: [],
              coverUrl: liked[0]?.thumbnailUrl,
              createdAt: Date.now(),
              isSystem: true,
            });
          }

          for (let i = 0; i < syncedPlaylists.length; i++) {
            const spPl = syncedPlaylists[i];
            // Update progress for each playlist
            setSpotifySyncProgress({
              phase: 'importing',
              message: `Importing playlist: ${spPl.name}...`,
              completed: i + 1,
              total: syncedPlaylists.length,
              currentItem: spPl.name,
              inProgress: true,
            });
            
            const plId = `sp-${spPl.spotifyId}`;
            const trackIds = (spPl.tracks || []).map((t) => t.id);
            const existing = next.find((p) => p.id === plId);
            if (existing) {
              next = next.map((p) =>
                p.id === plId
                  ? {
                      ...p,
                      name: spPl.name,
                      coverUrl: spPl.imageUrl || p.coverUrl,
                      trackIds: trackIds.length > 0 ? trackIds : p.trackIds,
                      spotifyId: spPl.spotifyId,
                    }
                  : p,
              );
            } else {
              next = [
                ...next,
                {
                  id: plId,
                  name: spPl.name,
                  description: 'Synced from Spotify',
                  trackIds,
                  tagIds: [],
                  coverUrl: spPl.imageUrl || spPl.tracks?.[0]?.thumbnailUrl,
                  createdAt: Date.now(),
                  spotifyId: spPl.spotifyId,
                },
              ];
            }
          }
          return next;
        });

        const unmatchedSuffix =
          data.unmatchedTracks?.length > 0
            ? ` · ${data.unmatchedTracks.length} unmatched`
            : '';
        const summary = `Synced ${liked.length} liked songs & ${syncedPlaylists.length} playlists from Spotify${unmatchedSuffix}`;
        
        // Final progress update
        setSpotifySyncProgress({
          phase: 'complete',
          message: summary,
          completed: liked.length + syncedPlaylists.length,
          total: liked.length + syncedPlaylists.length,
          inProgress: false,
        });
        
        if (!silent) showToast(summary);
        return { ok: true, message: summary };
      } catch {
        const errMsg = 'Network error while syncing Spotify library.';
        setSpotifySyncProgress({
          phase: 'error',
          message: errMsg,
          completed: 0,
          total: 0,
          inProgress: false,
        });
        if (!silent) showToast(errMsg, 'error');
        return { ok: false, message: errMsg };
      } finally {
        setSpotifySyncing(false);
        // Clear progress after a delay
        setTimeout(() => {
          setSpotifySyncProgress(null);
        }, 5000);
      }
    },
    [settings.contentLanguage, settings.contentRegion, showToast, spotifySyncing],
  );

  const syncSpotifyLibrary = useCallback(
    async (silent = false) => {
      if (!spotifyConnection?.loggedIn) {
        return { ok: false, message: 'Sign in to Spotify first.' };
      }
      return await syncSpotifyLibraryWithConnection(silent);
    },
    [spotifyConnection?.loggedIn, syncSpotifyLibraryWithConnection],
  );

  const connectSpotifyAccount = useCallback(async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    try {
      const res = await ytmClient.loginSpotify();
      if (res.ok && res.connection) {
        setSpotifyConnection(res.connection);
        showToast(`Connected Spotify account: ${res.connection.displayName}`);
        void syncSpotifyLibraryWithConnection(true);
        return { ok: true, message: `Connected Spotify as ${res.connection.displayName}` };
      }
      const msg = res.error || 'Spotify sign-in was cancelled.';
      if (!msg.toLowerCase().includes('closed')) {
        showToast(msg, 'error');
      }
      return { ok: false, message: msg };
    } catch {
      const msg = 'Could not open Spotify login window.';
      showToast(msg, 'error');
      return { ok: false, message: msg };
    }
  }, [showToast, syncSpotifyLibraryWithConnection]);

  const disconnectSpotifyAccount = useCallback(async () => {
    await ytmClient.logoutSpotify();
    setSpotifyConnection(null);
    setSessionUnmatchedTracks([]);
    showToast('Disconnected Spotify sync account');
  }, [showToast]);

  const updateSpotifySchedule = useCallback(
    async (schedule: SpotifySyncSchedule) => {
      const updated = await ytmClient.setSpotifySchedule(schedule);
      if (updated) {
        setSpotifyConnection(updated);
      } else {
        setSpotifyConnection((prev) => (prev ? { ...prev, syncSchedule: schedule } : prev));
      }
      showToast(
        schedule === 'MANUAL'
          ? 'Spotify auto-sync set to Manual Only'
          : `Spotify auto-sync scheduled: ${schedule.toLowerCase()}`,
      );
    },
    [showToast],
  );

  const dismissSpotifyUnmatched = useCallback(async (trackId: string) => {
    setSessionUnmatchedTracks((prev) => prev.filter((t) => t.id !== trackId));
    const updated = await ytmClient.dismissSpotifyUnmatched(trackId);
    if (updated) {
      setSpotifyConnection(updated);
    } else {
      setSpotifyConnection((prev) =>
        prev
          ? {
              ...prev,
              unmatchedTracks: (prev.unmatchedTracks || []).filter((t) => t.id !== trackId),
            }
          : prev,
      );
    }
  }, []);

  // Automatic scheduled Spotify Library sync
  useEffect(() => {
    if (!dbHydrated || !spotifyConnection?.loggedIn) return;
    const checkDue = () => {
      if (isSpotifyAutoSyncDue(spotifyConnection.syncSchedule, spotifyConnection.lastSyncedAt)) {
        void syncSpotifyLibraryWithConnection(true);
      }
    };
    checkDue();
    const timer = window.setInterval(checkDue, 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [dbHydrated, spotifyConnection, syncSpotifyLibraryWithConnection]);

  const importLocalFiles = useCallback(
    async (files: FileList | File[]): Promise<number> => {
      const list = Array.from(files);
      const audioFiles = list.filter(
        (f) =>
          f.type.startsWith('audio/') ||
          /\.(mp3|flac|wav|ogg|m4a|opus|aac)$/i.test(f.name),
      );
      if (audioFiles.length === 0) {
        showToast('No supported audio files found (.mp3, .flac, .wav, .ogg, .m4a)', 'error');
        return 0;
      }

      const importedTracks: Track[] = [];
      for (const file of audioFiles) {
        const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await saveLocalAudioBlob(id, file);
        const objectUrl = URL.createObjectURL(file);
        const dur = await readAudioFileDuration(objectUrl);
        const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const dashSplit = baseName.split(' - ');
        const artist = dashSplit.length >= 2 ? dashSplit[0].trim() : 'Local Library';
        const title = dashSplit.length >= 2 ? dashSplit.slice(1).join(' - ').trim() : baseName;

        importedTracks.push({
          id,
          title,
          artist,
          album: 'Local Audio',
          durationSec: dur,
          thumbnailUrl: FALLBACK_ARTWORK_DATA_URL,
          streamUrl: objectUrl,
          genre: 'Local File',
          qualityLabel: ext,
          source: 'local',
          addedAt: Date.now(),
        });
      }

      setTracks((prev) => [...importedTracks, ...prev]);
      showToast(`Imported ${importedTracks.length} local audio file(s)`);
      return importedTracks.length;
    },
    [showToast],
  );

  const addPlugin = useCallback(
    (plugin: Omit<ArchPlugin, 'id' | 'addedAt'>): ArchPlugin => {
      const created: ArchPlugin = {
        ...plugin,
        id: `arch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        addedAt: Date.now(),
      };
      setPlugins((prev) => [created, ...prev]);
      showToast(`Installed .arch plugin "${created.name}"`);
      return created;
    },
    [showToast],
  );

  const togglePlugin = useCallback((pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === pluginId ? { ...p, enabled: !p.enabled } : p)),
    );
  }, []);

  const removePlugin = useCallback(
    (pluginId: string) => {
      setPlugins((prev) => prev.filter((p) => p.id !== pluginId));
      showToast('Removed .arch plugin');
    },
    [showToast],
  );

  const searchYtMusicFull = useCallback(
    async (
      query: string,
      filter = 'all',
    ): Promise<{ tracks: Track[]; cards: YtMusicBrowseItem[] }> => {
      const q = query.trim();
      if (!q) return { tracks: [], cards: [] };
      try {
        const data = await ytmClient.searchYtm({
          query: q,
          filter,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        });
        return {
          tracks: data.tracks || [],
          cards: data.cards || [],
        };
      } catch {
        return { tracks: [], cards: [] };
      }
    },
    [settings.contentLanguage, settings.contentRegion],
  );

  const searchYtMusicTracks = useCallback(
    async (query: string, filter = 'songs'): Promise<Track[]> => {
      const q = query.trim();
      if (!q) return [];
      try {
        const data = await ytmClient.searchYtm({
          query: q,
          filter,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        });
        if (data.tracks && data.tracks.length > 0) return data.tracks;
        const cardTracks = (data.cards || [])
          .map((c) => c.track)
          .filter((t): t is Track => Boolean(t));
        return cardTracks;
      } catch {
        return [];
      }
    },
    [settings.contentLanguage, settings.contentRegion],
  );

  const fetchSearchSuggestions = useCallback(
    async (query: string): Promise<{ queries: string[]; items: YtMusicBrowseItem[] }> => {
      const q = query.trim();
      if (!q || !settings.ytMusicEnabled) return { queries: [], items: [] };
      try {
        return await ytmClient.getSearchSuggestions(
          q,
          settings.contentRegion || 'US',
          settings.contentLanguage || 'en',
        );
      } catch {
        return { queries: [], items: [] };
      }
    },
    [settings.contentLanguage, settings.contentRegion, settings.ytMusicEnabled],
  );

  const searchOnlineTracks = useCallback(
    async (query: string): Promise<Track[]> => {
      const q = query.trim();
      if (!q) return [];
      const enabledPlugins = plugins.filter((p) => p.enabled);

      const [ytTracks, ...pluginResults] = await Promise.all([
        settings.ytMusicEnabled ? searchYtMusicTracks(q, 'songs') : Promise.resolve([] as Track[]),
        ...enabledPlugins.map((p) => runArchPluginSearch(p, q).catch(() => [] as Track[])),
      ]);

      const combined = [...ytTracks, ...pluginResults.flat()];
      const seen = new Set<string>();
      return combined.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    },
    [plugins, searchYtMusicTracks, settings.ytMusicEnabled],
  );

  const recordSearchQuery = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || settings.pauseSearchHistory) return;
      setSearchHistory((prev) =>
        [trimmed, ...prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(
          0,
          15,
        ),
      );
    },
    [settings.pauseSearchHistory],
  );

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const selectEqProfile = useCallback((id: string) => {
    setEqState((prev) => ({ ...prev, activeId: id }));
  }, []);

  const updateEqBand = useCallback((bandIndex: number, db: number) => {
    setEqState((prev) => ({
      ...prev,
      profiles: prev.profiles.map((prof) => {
        if (prof.id !== prev.activeId) return prof;
        const levels = [...prof.bandLevelsDb];
        levels[bandIndex] = Math.max(-12, Math.min(12, db));
        return { ...prof, bandLevelsDb: levels, enabled: true };
      }),
    }));
  }, []);

  const updateEqParams = useCallback((patch: Partial<EqProfile>) => {
    setEqState((prev) => ({
      ...prev,
      profiles: prev.profiles.map((prof) =>
        prof.id === prev.activeId ? { ...prof, ...patch } : prof,
      ),
    }));
  }, []);

  const toggleRightPanel = useCallback((tab: 'lyrics' | 'queue') => {
    setRightPanel((curr) => (curr === tab ? 'closed' : tab));
  }, []);

  const exportBackupJson = useCallback(() => {
    const persistableTracks = tracks.filter((t) => t.source !== 'local');
    return JSON.stringify(
      {
        app: 'Riri Player',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        settings,
        eqState,
        tracks: persistableTracks,
        playlists,
        tags,
        playEvents,
        searchHistory,
        ytAuthStatus,
        spotifyConnection,
        ytSavedAlbums,
        ytFollowedArtists,
        ytUploadedTracks,
        ytHistoryTracks,
      },
      null,
      2,
    );
  }, [
    eqState,
    playEvents,
    playlists,
    searchHistory,
    settings,
    tags,
    tracks,
    ytFollowedArtists,
    ytSavedAlbums,
    ytUploadedTracks,
    ytHistoryTracks,
    ytAuthStatus,
    spotifyConnection,
  ]);

  const importBackupJson = useCallback(
    (jsonText: string): { ok: boolean; message: string } => {
      try {
        const parsed = JSON.parse(jsonText) as {
          app?: string;
          settings?: Partial<AppSettings>;
          eqState?: { profiles: EqProfile[]; activeId: string };
          tracks?: Track[];
          playlists?: Playlist[];
          tags?: PlaylistTag[];
          playEvents?: PlayEvent[];
          searchHistory?: string[];
          ytAuthStatus?: YtAuthStatusPayload | null;
          spotifyConnection?: SpotifyConnection | null;
          ytSavedAlbums?: YtMusicBrowseItem[];
          ytFollowedArtists?: YtMusicBrowseItem[];
          ytUploadedTracks?: Track[];
          ytHistoryTracks?: Track[];
        };
        if (parsed.app !== 'Riri Player' && parsed.app !== 'ArchiveTunePC') {
          return { ok: false, message: 'Invalid Riri Player backup file.' };
        }
        if (parsed.settings) {
          const sanitizedSettings = { ...parsed.settings } as Record<string, unknown>;
          delete sanitizedSettings.ytMusicVisitorData;
          delete sanitizedSettings.ytMusicPoToken;
          setSettings((s) => ({ ...s, ...(sanitizedSettings as Partial<AppSettings>) }));
        }
        if (parsed.eqState?.profiles?.length) setEqState(parsed.eqState);
        if (Array.isArray(parsed.tracks)) setTracks(parsed.tracks);
        if (Array.isArray(parsed.playlists)) setPlaylists(parsed.playlists);
        if (Array.isArray(parsed.tags)) setTags(parsed.tags);
        if (Array.isArray(parsed.playEvents)) setPlayEvents(parsed.playEvents);
        if (Array.isArray(parsed.searchHistory)) setSearchHistory(parsed.searchHistory);
        if (parsed.ytAuthStatus) setYtAuthStatus(parsed.ytAuthStatus);
        if (parsed.spotifyConnection) setSpotifyConnection(parsed.spotifyConnection);
        if (Array.isArray(parsed.ytSavedAlbums)) setYtSavedAlbums(parsed.ytSavedAlbums);
        if (Array.isArray(parsed.ytFollowedArtists)) setYtFollowedArtists(parsed.ytFollowedArtists);
        if (Array.isArray(parsed.ytUploadedTracks)) setYtUploadedTracks(parsed.ytUploadedTracks);
        if (Array.isArray(parsed.ytHistoryTracks)) setYtHistoryTracks(parsed.ytHistoryTracks);
        showToast('Backup restored successfully (accounts included - may need to re-sign in if sessions expired)');
        return { ok: true, message: 'Backup restored successfully.' };
      } catch {
        return { ok: false, message: 'Could not parse backup JSON.' };
      }
    },
    [showToast],
  );

  // Broadcast playback state for standalone Electron Always-On-Top Mini-Player window
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(MINI_OVERLAY_CHANNEL);

    // Compute current synced lyric line
    const parsedLyrics = parseLrcLyrics(activeTrackLyrics.syncedLyrics);
    const activeLyricIdx = findActiveLyricIndex(
      parsedLyrics,
      positionSec * 1000,
      settings.lyricsOffsetMs,
    );
    const activeLyricLine = activeLyricIdx >= 0 ? parsedLyrics[activeLyricIdx]?.text : null;

    ch.postMessage({
      type: 'STATE',
      payload: {
        currentTrack,
        isPlaying,
        positionSec,
        durationSec,
        repeatMode,
        shuffleEnabled,
        volume: settings.volume,
        miniOverlayTheme: settings.miniOverlayTheme,
        sliderStyle: settings.sliderStyle,
        themeSeedColor: settings.themeColor,
        darkMode: settings.darkMode,
        themeSurfaceStyle: settings.themeSurfaceStyle,
        activeLyricLine,
      },
    });
    return () => ch.close();
  }, [
    currentTrack,
    durationSec,
    isPlaying,
    positionSec,
    repeatMode,
    shuffleEnabled,
    settings.darkMode,
    settings.miniOverlayTheme,
    settings.sliderStyle,
    settings.themeColor,
    settings.themeSurfaceStyle,
    settings.volume,
    activeTrackLyrics.syncedLyrics,
    settings.lyricsOffsetMs,
  ]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(MINI_OVERLAY_CHANNEL);
    ch.onmessage = (e: MessageEvent<{
      type?: string;
      action?: string;
      positionSec?: number;
      volume?: number;
    }>) => {
      if (e.data?.type === 'REQUEST_STATE') {
        // Compute current synced lyric line
        const parsedLyrics = parseLrcLyrics(activeTrackLyrics.syncedLyrics);
        const activeLyricIdx = findActiveLyricIndex(
          parsedLyrics,
          positionSec * 1000,
          settings.lyricsOffsetMs,
        );
        const activeLyricLine = activeLyricIdx >= 0 ? parsedLyrics[activeLyricIdx]?.text : null;

        ch.postMessage({
          type: 'STATE',
          payload: {
            currentTrack,
            isPlaying,
            positionSec,
            durationSec,
            repeatMode,
            shuffleEnabled,
            volume: settings.volume,
            miniOverlayTheme: settings.miniOverlayTheme,
            sliderStyle: settings.sliderStyle,
            themeSeedColor: settings.themeColor,
            darkMode: settings.darkMode,
            themeSurfaceStyle: settings.themeSurfaceStyle,
            activeLyricLine,
          },
        });
      } else if (e.data?.type === 'CMD') {
        if (e.data.action === 'toggle') void togglePlayPause();
        if (e.data.action === 'next') void nextTrack();
        if (e.data.action === 'prev') void prevTrack();
        if (e.data.action === 'seek' && typeof e.data.positionSec === 'number') {
          seekTo(e.data.positionSec);
        }
        if (e.data.action === 'shuffle') void toggleShuffle();
        if (e.data.action === 'repeat') void cycleRepeatMode();
        if (e.data.action === 'volume' && typeof e.data.volume === 'number') {
          updateSettings({ volume: e.data.volume });
        }
        if (e.data.action === 'like' && currentTrack) {
          void toggleLike(currentTrack.id, currentTrack);
        }
        if (e.data.action === 'lyrics') {
          void closeMiniPlayer(false);
          toggleRightPanel('lyrics');
        }
        if (e.data.action === 'open-cinema') {
          closeMiniPlayer(true);
        }
      }
    };
    return () => ch.close();
  }, [
    closeMiniPlayer,
    currentTrack,
    durationSec,
    isPlaying,
    nextTrack,
    positionSec,
    prevTrack,
    repeatMode,
    seekTo,
    shuffleEnabled,
    settings.darkMode,
    settings.miniOverlayTheme,
    settings.sliderStyle,
    settings.themeColor,
    settings.themeSurfaceStyle,
    settings.volume,
    togglePlayPause,
    toggleRightPanel,
    updateSettings,
  ]);

  useEffect(() => {
    const api = getElectronBridge();
    api?.setMinimizeToTray?.(Boolean(settings.minimizeToTray));
  }, [settings.minimizeToTray]);

  useEffect(() => {
    const api = getElectronBridge();
    if (!api?.onMediaAction) return;
    return api.onMediaAction((action: string) => {
      if (action === 'play-pause') void togglePlayPause();
      if (action === 'next') void nextTrack();
      if (action === 'prev') void prevTrack();
    });
  }, [nextTrack, prevTrack, togglePlayPause]);

  const resetAllUserData = useCallback(async () => {
    try {
      await clearAllLocalDatabase();
    } catch {
      // ignore
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore
    }
    const api = getElectronBridge();
    if (api?.auth?.ytmLogout) {
      await api.auth.ytmLogout().catch(() => null);
    }
    setTracks([]);
    setPlaylists(DEFAULT_PLAYLISTS);
    setTags(DEFAULT_TAGS);
    setPlayEvents([]);
    setSearchHistory([]);
    setPlugins([]);
    setYtSavedAlbums([]);
    setYtFollowedArtists([]);
    setYtUploadedTracks([]);
    setYtHistoryTracks([]);
    setQueue([]);
    setSpotifyConnection(null);
    window.location.reload();
  }, []);

  const value: RiriPlayerContextValue = {
    route: currentView.route,
    routeParam: currentView.param,
    navigate,
    goBack,
    goForward,
    canGoBack,
    canGoForward,

    homeChip,
    setHomeChip,
    homeTracks,
    homeSections,
    homeChips,
    selectedHomeChipParams,
    setSelectedHomeChipParams,
    homeSourceLabel,
    homeLoading,
    chartsTracks,
    chartsLoading,
    loadCharts,
    browsedCollections,
    openYtMusicBrowse,

    tracks,
    playlists,
    tags,
    playEvents,
    searchHistory,
    plugins,
    settings,
    volume: settings.volume,

    ytAuthStatus,
    ytVaultDiagnostic,
    ytAccounts,
    activeYtAccount,
    signingInYtMusic,
    ytLoginError,
    clearYtLoginError,
    ytSavedAlbums,
    ytFollowedArtists,
    ytUploadedTracks,
    ytHistoryTracks,
    librarySyncProgress,
    lastLibrarySyncAt,
    signInWithYouTubeMusic,
    cancelYtMusicSignIn,
    importYtmBrowserSession,
    switchYtAccount,
    signOutYtAccount,
    syncYtMusicLibrary,

    spotifyConnection,
    spotifySyncing,
    spotifySyncProgress,
    spotifyUnmatchedTracks,
    connectSpotifyAccount,
    disconnectSpotifyAccount,
    syncSpotifyLibrary,
    updateSpotifySchedule,
    dismissSpotifyUnmatched,

    eqProfiles: eqState.profiles,
    activeEqId: eqState.activeId,
    activeEq,

    currentTrack,
    queue,
    queueIndex,
    isPlaying,
    positionSec,
    durationSec,
    repeatMode,
    shuffleEnabled,

    queueNextResult,
    queueNextLoading,
    fetchQueueNext,
    loadMoreQueueNext,
    toggleQueueChip,

    sleepTimerMinLeft,
    setSleepTimer,

    rightPanel,
    setRightPanel,
    toggleRightPanel,
    fullscreenPlayer,
    setFullscreenPlayer,
    isAppFullscreen,
    toggleAppFullscreen,
    showMiniOverlay,
    setShowMiniOverlay,
    openMiniPlayer,
    closeMiniPlayer,
    showEqModal,
    setShowEqModal,
    showSpotifyModal,
    setShowSpotifyModal,
    contextMenu,
    setContextMenu,
    toast,
    showToast,

    globalSearchQuery,
    setGlobalSearchQuery,
    searchOnlineTracks,
    searchYtMusicTracks,
    searchYtMusicFull,
    fetchSearchSuggestions,

    playTrack,
    playNext,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    addToQueue,
    moveQueueItem,
    removeQueueItem,
    clearQueue,
    cycleRepeatMode,
    toggleShuffle,

    toggleLike,
    isTrackLiked,
    createPlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deletePlaylist,
    exportPlaylistM3u,
    importSpotifyPlaylist,
    importYtMusicPlaylist,
    importLocalFiles,

    addPlugin,
    togglePlugin,
    removePlugin,

    libraryFilter,
    setLibraryFilter,
    selectedTagId,
    setSelectedTagId,

    recordSearchQuery,
    clearSearchHistory,
    updateSettings,

    selectEqProfile,
    updateEqBand,
    updateEqParams,

    exportBackupJson,
    importBackupJson,
    resetAllUserData,
    dynamicArtworkSecondary,
    activeTrackLyrics,
    refreshCurrentLyrics,
  };

  return <RiriPlayerContext.Provider value={value}>{children}</RiriPlayerContext.Provider>;
};

export function useRiriPlayer(): RiriPlayerContextValue {
  const ctx = useContext(RiriPlayerContext);
  if (!ctx) {
    throw new Error('useRiriPlayer must be used within RiriPlayerProvider');
  }
  return ctx;
}
