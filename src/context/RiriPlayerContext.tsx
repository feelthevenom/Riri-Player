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
  waitForPendingLibraryWrites,
  type PersistedLibraryState,
  type PersistedQueueState,
} from '../utils/storageDb';
import { runArchPluginSearch, resolveArchPluginStream } from '../utils/archPluginRunner';
import { findActiveLyricIndex, parseLrcLyrics } from '../utils/lyricsParser';
import { lyricsService } from '../utils/lyricsService';
import { hasNonLatinScript } from '../utils/transliterate';
import {
  appendUniqueQueueSuggestions,
  PlayQueueModeOptions,
  replaceUpcomingQueueWithRadio,
  shouldUseUnlimitedQueue,
} from '../utils/queueHelpers';
import { isSpotifyAutoSyncDue } from '../utils/spotifySyncHelpers';
import {
  applyLikedTrackIdsToTracks,
  collectIndependentYtTrackIds,
  deriveLikedTrackSets,
  isAuthoritativeYtLibrarySnapshot,
  isPersistedYtAccountMatch,
  isPersistedYtQueueOwnedByAccount,
  mergeLikedTrackIds,
  mergeSyncedYtPlaylists,
  scopeYtMusicTracksToAccount,
  tagYtMusicTracksForAccount,
} from '../utils/ytmLibraryState';
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

function isAuthoritativeYtAuthStatus(
  value: YtAuthStatusPayload,
): value is YtAuthStatusPayload {
  if (
    typeof value?.loggedIn !== 'boolean' ||
    !Array.isArray(value.accounts) ||
    value.accounts.some(
      (account) =>
        !account ||
        typeof account.id !== 'string' ||
        !account.id ||
        typeof account.name !== 'string',
    )
  ) {
    return false;
  }
  if (!value.loggedIn) return true;
  return Boolean(
    typeof value.activeAccountId === 'string' &&
      value.activeAccountId &&
      value.accounts.some((account) => account.id === value.activeAccountId),
  );
}

function parseOptimisticYtAuthStatus(value: unknown): YtAuthStatusPayload | null {
  if (!value || typeof value !== 'object') return null;
  const status = value as Partial<YtAuthStatusPayload>;
  if (
    typeof status.loggedIn !== 'boolean' ||
    !Array.isArray(status.accounts) ||
    status.accounts.some(
      (account) =>
        !account ||
        typeof account !== 'object' ||
        typeof account.id !== 'string' ||
        typeof account.name !== 'string',
    )
  ) {
    return null;
  }
  if (
    status.activeAccountId !== null &&
    status.activeAccountId !== undefined &&
    typeof status.activeAccountId !== 'string'
  ) {
    return null;
  }
  return status as YtAuthStatusPayload;
}

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
    {
      title: string;
      subtitle: string;
      thumbnailUrl?: string;
      tracks: Track[];
      cards: YtMusicBrowseItem[];
      loading?: boolean;
    }
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
  ytAccountMutationPending: boolean;
  ytLoginError: string | null;
  ytLoginRetryable: boolean;
  ytLoginBlocked: boolean;
  clearYtLoginError: () => void;
  retryYtMusicSignIn: () => Promise<{
    ok: boolean;
    blocked?: boolean;
    cancelled?: boolean;
    retryable?: boolean;
    message: string;
  }>;
  resetYtVault: () => Promise<{ ok: boolean; message: string }>;
  ytSavedAlbums: YtMusicBrowseItem[];
  ytFollowedArtists: YtMusicBrowseItem[];
  ytUploadedTracks: Track[];
  ytHistoryTracks: Track[];
  librarySyncProgress: LibrarySyncProgress | null;
  lastLibrarySyncAt: number | null;
  signInWithYouTubeMusic: (options?: {
    cleanPartition?: boolean;
  }) => Promise<{
    ok: boolean;
    blocked?: boolean;
    cancelled?: boolean;
    retryable?: boolean;
    message: string;
  }>;
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

  playTrack: (track: Track, newQueue?: Track[], options?: PlayQueueModeOptions) => Promise<void>;
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
  toggleLyricsLanguage: () => void;

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
  effectiveThemeColor: string;

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
    englishLyrics: string[] | null;
    translations: string[];
    source: string | null;
    provider?: string | null;
    hasAlternateLanguage?: boolean;
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
      {
        title: string;
        subtitle: string;
        thumbnailUrl?: string;
        tracks: Track[];
        cards: YtMusicBrowseItem[];
        loading?: boolean;
      }
    >
  >({});

  const [dbHydrated, setDbHydrated] = useState(false);
  const [proxyReady, setProxyReady] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>(DEFAULT_PLAYLISTS);
  const playlistsRef = useRef<Playlist[]>(DEFAULT_PLAYLISTS);
  playlistsRef.current = playlists;
  const [ytmLikedTrackIds, setYtmLikedTrackIds] = useState<string[]>([]);
  const [localLikedTrackIds, setLocalLikedTrackIds] = useState<string[]>([]);
  const ytmLikedTrackIdsRef = useRef(new Set<string>());
  const localLikedTrackIdsRef = useRef(new Set<string>());
  const [tags, setTags] = useState<PlaylistTag[]>(DEFAULT_TAGS);
  const [playEvents, setPlayEvents] = useState<PlayEvent[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<ArchPlugin[]>([]);

  const [ytAuthStatus, setYtAuthStatus] = useState<YtAuthStatusPayload | null>(null);
  const ytAuthStatusRef = useRef<YtAuthStatusPayload | null>(null);
  const [ytAuthVerified, setYtAuthVerified] = useState(false);
  const pendingPersistedLibraryRef = useRef<PersistedLibraryState | null>(null);
  const pendingPersistedQueueRef = useRef<{
    state: PersistedQueueState;
    independentTrackIds: Set<string>;
    libraryAccountId: string | null;
  } | null>(null);
  const accountEpochRef = useRef(0);
  const accountMutationVersionRef = useRef(0);
  const isResettingRef = useRef(false);
  const [ytVaultDiagnostic, setYtVaultDiagnostic] = useState<{ error?: string; unreadableFile?: boolean } | null>(null);
  const [signingInYtMusic, setSigningInYtMusic] = useState(false);
  const [ytAccountMutationPending, setYtAccountMutationPending] = useState(false);
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
  const likeMutationVersionRef = useRef(new Map<string, number>());
  const likeDesiredStateRef = useRef(new Map<string, boolean>());
  const [positionSec, setPositionSec] = useState(0);
  const positionSecRef = useRef(0);
  positionSecRef.current = positionSec;
  const miniOverlayPublisherRef = useRef<BroadcastChannel | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('OFF');
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [queueNextResult, setQueueNextResult] = useState<YtMusicNextResult | null>(null);
  const [queueNextLoading, setQueueNextLoading] = useState(false);
  const queueNextRequestIdRef = useRef(0);
  const queueUnlimitedRef = useRef(true);
  const fetchQueueNextRef = useRef<typeof fetchQueueNext | null>(null);
  const loadMoreQueueNextRef = useRef<typeof loadMoreQueueNext | null>(null);
  const syncYtMusicLibraryRef = useRef<typeof syncYtMusicLibrary | null>(null);
  const librarySyncRequestIdRef = useRef(0);
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
  const [ytLoginRetryable, setYtLoginRetryable] = useState(false);
  const [ytLoginBlocked, setYtLoginBlocked] = useState(false);
  const ytLoginOptionsRef = useRef<{ cleanPartition?: boolean } | undefined>(undefined);
  const clearYtLoginError = useCallback(() => {
    setYtLoginError(null);
    setYtLoginRetryable(false);
    setYtLoginBlocked(false);
  }, []);

  const [dynamicArtworkPrimary, setDynamicArtworkPrimary] = useState<string | null>(null);
  const [dynamicArtworkSecondary, setDynamicArtworkSecondary] = useState<string>('#1c1317');
  const [activeTrackLyrics, setActiveTrackLyrics] = useState<{
    syncedLyrics: string | null;
    plainLyrics: string | null;
    englishLyrics: string[] | null;
    translations: string[];
    source: string | null;
    provider?: string | null;
    hasAlternateLanguage?: boolean;
    loading: boolean;
  }>({
    syncedLyrics: null,
    plainLyrics: null,
    englishLyrics: null,
    translations: [],
    source: null,
    provider: null,
    hasAlternateLanguage: false,
    loading: false,
  });
  const lyricsRequestIdRef = useRef(0);
  const lyricsAbortRef = useRef<AbortController | null>(null);

  const ytAccounts = useMemo<YtAccountSummary[]>(
    () => ytAuthStatus?.accounts || [],
    [ytAuthStatus],
  );

  const activeYtAccount = useMemo<YtAccountSummary | null>(() => {
    if (!ytAuthStatus?.loggedIn) return null;
    const list = ytAuthStatus.accounts || [];
    return (
      (ytAuthStatus.activeAccountId
        ? list.find((a) => a.id === ytAuthStatus.activeAccountId)
        : undefined) ||
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

  const commitLikedTrackSets = useCallback(
    (
      nextYtmLikedIds: Iterable<string>,
      nextLocalLikedIds: Iterable<string>,
      updateTrackFlags = true,
    ) => {
      const remote = Array.from(new Set(Array.from(nextYtmLikedIds).filter(Boolean)));
      const local = Array.from(new Set(Array.from(nextLocalLikedIds).filter(Boolean)));
      const aggregate = mergeLikedTrackIds(remote, local);

      ytmLikedTrackIdsRef.current = new Set(remote);
      localLikedTrackIdsRef.current = new Set(local);
      setYtmLikedTrackIds(remote);
      setLocalLikedTrackIds(local);

      setPlaylists((prev) => {
        const existing = prev.find((playlist) => playlist.id === 'pl-liked');
        if (existing) {
          return prev.map((playlist) =>
            playlist.id === 'pl-liked'
              ? {
                  ...playlist,
                  trackIds: aggregate,
                }
              : playlist,
          );
        }
        return [
          {
            id: 'pl-liked',
            name: 'Liked Songs',
            description: 'Your favorite tracks saved in Riri Player',
            trackIds: aggregate,
            tagIds: [],
            createdAt: Date.now(),
            isSystem: true,
          },
          ...prev,
        ];
      });

      if (updateTrackFlags) {
        setTracks((prev) => applyLikedTrackIdsToTracks(prev, aggregate));
      }
      setCurrentTrack((current) =>
        current ? { ...current, liked: aggregate.includes(current.id) } : current,
      );
    },
    [],
  );

  const clearYtAccountLibraryState = useCallback(
    (nextAccountId?: string | null) => {
      accountEpochRef.current += 1;
      queueNextRequestIdRef.current += 1;
      const independentTrackIds = collectIndependentYtTrackIds(
        playlistsRef.current,
        localLikedTrackIdsRef.current,
      );
      const scopeAccountTracks = (items: Track[]): Track[] =>
        scopeYtMusicTracksToAccount(items, nextAccountId, independentTrackIds);

      setTracks((prev) => scopeAccountTracks(prev));
      const scopedQueue = scopeAccountTracks(queueRef.current);
      queueRef.current = scopedQueue;
      setQueue(scopedQueue);
      const scopedQueueIndex =
        scopedQueue.length > 0
          ? Math.max(0, Math.min(queueIndexRef.current, scopedQueue.length - 1))
          : 0;
      queueIndexRef.current = scopedQueueIndex;
      setQueueIndex(scopedQueueIndex);
      const scopedCurrent = currentTrackRef.current
        ? scopeAccountTracks([currentTrackRef.current])[0] || null
        : null;
      currentTrackRef.current = scopedCurrent;
      setCurrentTrack(scopedCurrent);
      if (!scopedCurrent) {
        audioEngine.pause();
        setIsPlaying(false);
        setPositionSec(0);
        setDurationSec(0);
      }
      setPlaylists((prev) => prev.filter((playlist) => !playlist.ytBrowseId));
      setYtSavedAlbums([]);
      setYtFollowedArtists([]);
      setYtUploadedTracks([]);
      setYtHistoryTracks([]);
      setLastLibrarySyncAt(null);
      setBrowsedCollections({});
      setChartsTracks([]);
      setQueueNextResult(null);
      setHomeSections([]);
      setHomeTracks([]);
      setHomeChips([]);
      setSelectedHomeChipParams(null);
      setHomeSourceLabel('YouTube Music');
      ytmLikedTrackIdsRef.current = new Set();
      setYtmLikedTrackIds([]);
    },
    [],
  );

  const applyAuthoritativeYtStatus = useCallback(
    (nextStatus: YtAuthStatusPayload) => {
      if (!isAuthoritativeYtAuthStatus(nextStatus)) {
        throw new Error('YouTube Music returned an invalid authoritative account status.');
      }
      const previousAccountId = ytAuthStatusRef.current?.activeAccountId || null;
      const nextAccountId = nextStatus.loggedIn
        ? nextStatus.activeAccountId || null
        : null;
      ytAuthStatusRef.current = nextStatus;
      setYtAuthStatus(nextStatus);
      setYtAuthVerified(true);
      if (previousAccountId !== nextAccountId) {
        clearYtAccountLibraryState(nextAccountId);
        commitLikedTrackSets([], localLikedTrackIdsRef.current);
        setYtLoginError(null);
        setYtLoginRetryable(false);
        setYtLoginBlocked(false);
      }
    },
    [clearYtAccountLibraryState, commitLikedTrackSets],
  );

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

    // Restore the sanitized account summary immediately for a flicker-free UI.
    // The main process remains the source of truth because this backup does
    // not contain the cookies needed to load Home or synchronize a library.
    try {
      const saved = localStorage.getItem(YT_AUTH_LOCAL_KEY);
      if (saved) {
        const parsed = parseOptimisticYtAuthStatus(JSON.parse(saved));
        if (parsed?.loggedIn) {
          ytAuthStatusRef.current = parsed;
          setYtAuthStatus(parsed);
        }
      }
    } catch {
      // ignore localStorage parse errors
    }

    const fetchAuth = async (): Promise<YtAuthStatusPayload | null> => {
      if (cancelled) return null;
      const requestMutationVersion = accountMutationVersionRef.current;
      try {
        const status = await ytmClient.getYtmStatus();
        if (requestMutationVersion !== accountMutationVersionRef.current) return null;
        // Read the diagnostic after the status attempt so it reflects the same
        // vault read that produced the status. An unreadable vault is not a
        // confirmed logout and must not erase the renderer backup.
        const diagnostic = await ytmClient.getYtmVaultDiagnostic().catch(() => null);
        if (!cancelled) setYtVaultDiagnostic(diagnostic ?? null);
        if (!cancelled && diagnostic?.unreadableFile) {
          // The summary may remain visible optimistically, but it is not an
          // authoritative basis for restoring or overwriting remote state.
          setYtAuthVerified(false);
          return null;
        }
        if (!cancelled && status.loggedIn) {
          applyAuthoritativeYtStatus(status);
          try {
            localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(status));
          } catch {
            // ignore
          }
        } else if (!cancelled) {
          applyAuthoritativeYtStatus(status);
          try {
            localStorage.removeItem(YT_AUTH_LOCAL_KEY);
          } catch {
            // ignore
          }
        }
        return status;
      } catch (err) {
        // A vault/partition restoration failure must not become an unhandled
        // renderer rejection. Keep the last known summary only as an optimistic
        // UI state and expose the real diagnostic instead of claiming that the
        // session was verified.
        if (!cancelled) {
          setYtAuthVerified(false);
          const diagnostic = await ytmClient.getYtmVaultDiagnostic().catch(() => null);
          setYtVaultDiagnostic({
            ...(diagnostic || {}),
            error:
              diagnostic?.error ||
              (err instanceof Error ? err.message : 'Failed to read YouTube Music sign-in status.'),
          });
        }
        return null;
      }
    };

    const initAuth = async () => {
      if (cancelled) return;

      try {
        // On every app start, invalidate the vault cache so a fresh read is forced.
        await ytmClient.invalidateYtmVaultCache();
      } catch (err) {
        if (!cancelled) {
          setYtVaultDiagnostic({
            error:
              err instanceof Error ? err.message : 'Failed to refresh the session vault.',
          });
        }
      }

      // The status handler also attempts to restore the account from the
      // persistent YouTube Music login partition before returning.
      await fetchAuth();

      // Sample the diagnostic after the status attempt. The earlier value may
      // have been captured before safeStorage had attempted its first read.
      const diagnostic = await ytmClient.getYtmVaultDiagnostic().catch(() => null);
      if (!cancelled) setYtVaultDiagnostic(diagnostic ?? null);

      // If safeStorage was not ready yet, retry independently of the
      // localStorage summary so a real vault/session is always preferred.
      if (!cancelled && diagnostic?.unreadableFile) {
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          void (async () => {
            try {
              await ytmClient.invalidateYtmVaultCache();
            } catch {
              // fetchAuth below will surface the diagnostic
            }
            const status = await fetchAuth();
            if (!cancelled && !status?.loggedIn) {
              retryTimer = setTimeout(() => {
                if (cancelled) return;
                void (async () => {
                  try {
                    await ytmClient.invalidateYtmVaultCache();
                  } catch {
                    // ignore; fetchAuth reports the failure
                  }
                  await fetchAuth();
                })();
              }, 2000);
            }
          })();
        }, 1000);
      }
    };

    void initAuth().catch(() => undefined);

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
  }, [applyAuthoritativeYtStatus, proxyReady]);

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

  // Hydrate persistent library state + saved playback queue from IndexedDB.
  // Local/independent state is restored immediately. YouTube Music-owned state
  // is held until the encrypted vault identifies the authoritative account.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadLibraryStateFromDb(), loadQueueStateFromDb()])
      .then(([persisted, savedQueue]) => {
        if (cancelled) return;
        let independentTrackIds = new Set<string>();
        if (persisted) {
          const persistedTracks = (persisted.tracks || []).map(redecorateTrack);
          const persistedPlaylists = (
            persisted.playlists?.length ? persisted.playlists : DEFAULT_PLAYLISTS
          ).map(redecoratePlaylist);
          const persistedLikedIds =
            persistedPlaylists.find((playlist) => playlist.id === 'pl-liked')?.trackIds || [];
          const likedSets = deriveLikedTrackSets({
            persistedLikedIds,
            persistedYtmLikedIds: persisted.ytmLikedTrackIds,
            persistedLocalLikedIds: persisted.localLikedTrackIds,
            tracks: persistedTracks,
            playlists: persistedPlaylists,
          });
          independentTrackIds = collectIndependentYtTrackIds(
            persistedPlaylists,
            likedSets.localLikedIds,
          );
          const safeTracks = scopeYtMusicTracksToAccount(
            persistedTracks,
            null,
            independentTrackIds,
          );
          const safePlaylists = persistedPlaylists.filter(
            (playlist) => !playlist.ytBrowseId,
          );
          const safeAggregateLikedIds = mergeLikedTrackIds([], likedSets.localLikedIds);

          setTracks(applyLikedTrackIdsToTracks(safeTracks, safeAggregateLikedIds));
          setPlaylists(safePlaylists);
          commitLikedTrackSets([], likedSets.localLikedIds, false);
          setTags(persisted.tags?.length ? persisted.tags : DEFAULT_TAGS);
          setPlayEvents(persisted.playEvents || []);
          setSearchHistory(persisted.searchHistory || []);
          setPlugins(persisted.plugins || []);
          setYtSavedAlbums([]);
          setYtFollowedArtists([]);
          setYtUploadedTracks([]);
          setYtHistoryTracks([]);
          setLastLibrarySyncAt(null);
          if (persisted.spotifyConnection) {
            setSpotifyConnection((curr) => curr || persisted.spotifyConnection || null);
          }

          // Preserve the original snapshot until the authoritative account is
          // known. If its account id matches, the remote snapshot can be
          // restored safely; otherwise only independent state survives.
          pendingPersistedLibraryRef.current = {
            ...persisted,
            tracks: persistedTracks,
            playlists: persistedPlaylists,
            ytmLikedTrackIds: likedSets.ytmLikedIds,
            localLikedTrackIds: likedSets.localLikedIds,
          };
        }
        if (savedQueue && savedQueue.queue.length > 0) {
          // Restore only independent/local entries immediately. Remote queue
          // entries remain pending until the encrypted vault identifies their
          // owner account.
          pendingPersistedQueueRef.current = {
            state: savedQueue,
            independentTrackIds: new Set(independentTrackIds),
            libraryAccountId: persisted?.activeYtAccountId || null,
          };
          const scopedQueue = scopeYtMusicTracksToAccount(
            savedQueue.queue,
            null,
            independentTrackIds,
          );
          const originalCurrentId = savedQueue.queue[savedQueue.queueIndex]?.id;
          const retainedCurrentIndex = scopedQueue.findIndex(
            (track) => track.id === originalCurrentId,
          );
          const safeIdx =
            retainedCurrentIndex >= 0
              ? retainedCurrentIndex
              : Math.max(
                  0,
                  Math.min(savedQueue.queueIndex || 0, scopedQueue.length - 1),
                );
          setQueue(scopedQueue);
          setQueueIndex(scopedQueue.length > 0 ? safeIdx : 0);
          setRepeatMode(savedQueue.repeatMode || 'OFF');
          setShuffleEnabled(Boolean(savedQueue.shuffleEnabled));
          setCurrentTrack(scopedQueue[safeIdx] || null);
          setPositionSec(savedQueue.positionSec || 0);
          setDurationSec(scopedQueue[safeIdx]?.durationSec || 0);
        }
        setDbHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setDbHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [commitLikedTrackSets]);

  // Apply the persisted YouTube Music snapshot only after the encrypted vault
  // has been read successfully and its active account matches the snapshot.
  useEffect(() => {
    if (!dbHydrated || !ytAuthVerified) return;
    const persisted = pendingPersistedLibraryRef.current;
    if (!persisted) return;
    pendingPersistedLibraryRef.current = null;

    const activeAccountId =
      ytAuthStatus?.loggedIn && ytAuthStatus.activeAccountId
        ? ytAuthStatus.activeAccountId
        : null;
    const persistedAccountId = persisted.activeYtAccountId || null;
    const accountMatches = isPersistedYtAccountMatch(
      activeAccountId,
      persistedAccountId,
    );

    const persistedTracks = (persisted.tracks || []).map(redecorateTrack);
    const persistedPlaylists = (
      persisted.playlists?.length ? persisted.playlists : DEFAULT_PLAYLISTS
    ).map(redecoratePlaylist);
    const likedSets = deriveLikedTrackSets({
      persistedLikedIds:
        persistedPlaylists.find((playlist) => playlist.id === 'pl-liked')?.trackIds || [],
      persistedYtmLikedIds: persisted.ytmLikedTrackIds,
      persistedLocalLikedIds: persisted.localLikedTrackIds,
      tracks: persistedTracks,
      playlists: persistedPlaylists,
    });
    const independentTrackIds = collectIndependentYtTrackIds(
      persistedPlaylists,
      likedSets.localLikedIds,
    );
    const accountCandidate = accountMatches && activeAccountId
      ? tagYtMusicTracksForAccount(
          persistedTracks,
          activeAccountId,
          independentTrackIds,
        )
      : persistedTracks;
    const scopedTracks = scopeYtMusicTracksToAccount(
      accountCandidate,
      activeAccountId,
      independentTrackIds,
    );
    const scopedPlaylists = accountMatches
      ? persistedPlaylists
      : persistedPlaylists.filter((playlist) => !playlist.ytBrowseId);
    const authorizedYtmLikedIds = accountMatches ? likedSets.ytmLikedIds : [];
    const aggregateLikedIds = mergeLikedTrackIds(
      authorizedYtmLikedIds,
      likedSets.localLikedIds,
    );

    setTracks(applyLikedTrackIdsToTracks(scopedTracks, aggregateLikedIds));
    setPlaylists(scopedPlaylists);
    commitLikedTrackSets(authorizedYtmLikedIds, likedSets.localLikedIds, false);
    setYtSavedAlbums(
      accountMatches
        ? (persisted.ytSavedAlbums || []).map(redecorateBrowseItem)
        : [],
    );
    setYtFollowedArtists(
      accountMatches
        ? (persisted.ytFollowedArtists || []).map(redecorateBrowseItem)
        : [],
    );
    setYtUploadedTracks(
      accountMatches
        ? (persisted.ytUploadedTracks || []).map(redecorateTrack)
        : [],
    );
    setYtHistoryTracks(
      accountMatches
        ? (persisted.ytHistoryTracks || []).map(redecorateTrack)
        : [],
    );
    setLastLibrarySyncAt(accountMatches ? persisted.lastLibrarySyncAt || null : null);
  }, [
    commitLikedTrackSets,
    dbHydrated,
    ytAuthStatus?.activeAccountId,
    ytAuthStatus?.loggedIn,
    ytAuthVerified,
  ]);

  // Restore account-owned queue entries only after the vault has identified
  // the same account that owned the persisted library/queue snapshot.
  useEffect(() => {
    if (!dbHydrated || !ytAuthVerified) return;
    const pending = pendingPersistedQueueRef.current;
    if (!pending) return;
    pendingPersistedQueueRef.current = null;

    const activeAccountId =
      ytAuthStatus?.loggedIn && ytAuthStatus.activeAccountId
        ? ytAuthStatus.activeAccountId
        : null;
    const queueOwnerId = pending.state.activeYtAccountId || null;
    const ownerMatches = isPersistedYtQueueOwnedByAccount(
      activeAccountId,
      queueOwnerId,
      pending.libraryAccountId,
    );
    const candidate = ownerMatches && activeAccountId
      ? tagYtMusicTracksForAccount(
          pending.state.queue,
          activeAccountId,
          pending.independentTrackIds,
        )
      : pending.state.queue;
    const scopedQueue = scopeYtMusicTracksToAccount(
      candidate,
      activeAccountId,
      pending.independentTrackIds,
    );
    const originalCurrentId =
      pending.state.queue[pending.state.queueIndex]?.id;
    const retainedCurrentIndex = scopedQueue.findIndex(
      (track) => track.id === originalCurrentId,
    );
    const safeIdx =
      retainedCurrentIndex >= 0
        ? retainedCurrentIndex
        : Math.max(
            0,
            Math.min(pending.state.queueIndex || 0, scopedQueue.length - 1),
          );

    setQueue(scopedQueue);
    setQueueIndex(scopedQueue.length > 0 ? safeIdx : 0);
    setCurrentTrack(scopedQueue[safeIdx] || null);
    setPositionSec(pending.state.positionSec || 0);
    setDurationSec(scopedQueue[safeIdx]?.durationSec || 0);
  }, [
    dbHydrated,
    ytAuthStatus?.activeAccountId,
    ytAuthStatus?.loggedIn,
    ytAuthVerified,
  ]);

  // Persist sanitized library state to IndexedDB. Do not overwrite a stored
  // account snapshot while the encrypted vault is still unreadable/unverified.
  useEffect(() => {
    if (!dbHydrated || !ytAuthVerified) return;
    const timer = window.setTimeout(() => {
      if (isResettingRef.current) return;
      void saveLibraryStateToDb({
        tracks,
        playlists,
        tags,
        playEvents,
        searchHistory,
        plugins,
        activeYtAccountId: ytAuthStatus?.activeAccountId || null,
        ytSavedAlbums,
        ytFollowedArtists,
        ytUploadedTracks,
        ytHistoryTracks,
        lastLibrarySyncAt: lastLibrarySyncAt || undefined,
        spotifyConnection,
        ytmLikedTrackIds,
        localLikedTrackIds,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    dbHydrated,
    lastLibrarySyncAt,
    ytAuthStatus?.activeAccountId,
    localLikedTrackIds,
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
    ytmLikedTrackIds,
    ytAuthVerified,
  ]);

  // Persist queue snapshot periodically when queue changes. An unreadable or
  // unverified vault must not overwrite the last known account-owned queue.
  useEffect(() => {
    if (!dbHydrated || !ytAuthVerified) return;
    const timer = window.setTimeout(() => {
      if (isResettingRef.current) return;
      void saveQueueStateToDb({
        queue,
        queueIndex,
        repeatMode,
        shuffleEnabled,
        positionSec,
        savedAt: Date.now(),
        activeYtAccountId: ytAuthStatus?.activeAccountId || null,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    dbHydrated,
    positionSec,
    queue,
    queueIndex,
    repeatMode,
    shuffleEnabled,
    ytAuthStatus?.activeAccountId,
    ytAuthVerified,
  ]);

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
        if (
          !data.sections?.length &&
          !data.tracks?.length &&
          !data.chips?.length
        ) {
          throw new Error('YouTube Music returned an empty Home feed.');
        }
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
          showToast('Could not load YouTube Music Home. Check your connection and try again.', 'error');
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
    showToast,
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
          thumbnailUrl: prev[cleanId]?.thumbnailUrl || '',
          tracks: prev[cleanId]?.tracks || [],
          cards: prev[cleanId]?.cards || [],
          loading: true,
        },
      }));
      const requestAccountId = ytAuthStatusRef.current?.activeAccountId || null;
      try {
        const data = await ytmClient.browseCollection({
          browseId: cleanId,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        });
        if ((ytAuthStatusRef.current?.activeAccountId || null) !== requestAccountId) {
          return;
        }
        setBrowsedCollections((prev) => {
          const next = {
            ...prev,
            [cleanId]: {
              title: data.title || titleHint,
              subtitle: data.subtitle || `${(data.tracks || []).length} track(s)`,
              thumbnailUrl: data.thumbnailUrl || '',
              tracks: data.tracks || [],
              cards: data.items || [],
              loading: false,
            },
          };
          const keys = Object.keys(next);
          if (keys.length > 12) {
            for (const oldKey of keys.slice(0, keys.length - 12)) {
              if (oldKey !== cleanId) delete next[oldKey];
            }
          }
          return next;
        });
      } catch {
        if ((ytAuthStatusRef.current?.activeAccountId || null) !== requestAccountId) {
          return;
        }
        setBrowsedCollections((prev) => ({
          ...prev,
          [cleanId]: {
            title: titleHint,
            subtitle: 'Could not load this YouTube Music item.',
            thumbnailUrl: '',
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

  const effectiveThemeColor =
    settings.dynamicThemeFromArtwork && dynamicArtworkPrimary
      ? dynamicArtworkPrimary
      : settings.themeColor;

  // Theme application
  useEffect(() => {
    applyMaterialTheme(
      effectiveThemeColor,
      settings.darkMode,
      settings.pureBlack,
      settings.themeSurfaceStyle,
    );
  }, [
    effectiveThemeColor,
    settings.darkMode,
    settings.pureBlack,
    settings.themeSurfaceStyle,
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

  // Fetch lyrics, then load optional translation/transliteration without
  // delaying the native lyric display. Every request is scoped to the active
  // track so a fast track change cannot overwrite the newer song's lyrics.
  const fetchLyricsForTrack = useCallback(
    async (track: Track, options?: { forceRefresh?: boolean }) => {
      const requestId = ++lyricsRequestIdRef.current;
      lyricsAbortRef.current?.abort();
      const controller = new AbortController();
      lyricsAbortRef.current = controller;
      const isCurrentRequest = () => requestId === lyricsRequestIdRef.current;
      const queueSourceVideoId = queueNextResult?.sourceVideoId;
      const lyricsBrowseId =
        queueSourceVideoId && queueSourceVideoId === track.ytMusicVideoId
          ? queueNextResult?.lyricsBrowseId
          : undefined;

      let synced = track.syncedLyrics || null;
      let plain = track.plainLyrics || null;
      let source: string | null = synced || plain ? 'Cached' : null;
      let provider: string | null = synced || plain ? 'cache' : null;

      setActiveTrackLyrics({
        syncedLyrics: synced,
        plainLyrics: plain,
        englishLyrics: null,
        translations: [],
        source,
        provider,
        hasAlternateLanguage: false,
        loading: !(synced || plain),
      });

      if (!synced && !plain) {
        try {
          const result = await lyricsService.fetchLyrics({
            title: track.title,
            artist: track.artist,
            videoId: track.ytMusicVideoId,
            duration: track.durationSec,
            lyricsBrowseId,
            lyricsBrowseVideoId: lyricsBrowseId ? queueSourceVideoId : undefined,
            gl: settings.contentRegion || 'US',
            hl: settings.contentLanguage || 'en',
            providers: settings.lyricsProviders,
            signal: controller.signal,
            forceRefresh: options?.forceRefresh,
          });
          if (!isCurrentRequest()) return;
          if (result.ok) {
            synced = result.syncedLyrics || null;
            plain = result.plainLyrics || null;
            source = result.source || null;
            provider = result.provider || null;
          }
        } catch {
          // A missing lyric provider must not interrupt playback.
        }
      }

      if (!isCurrentRequest()) return;

      const lyricText = synced || plain || '';
      const containsNonLatin = hasNonLatinScript(lyricText);
      let hasAlternateLanguage = containsNonLatin;
      const parsed = synced ? parseLrcLyrics(synced) : [];
      const lyricLines = parsed.length
        ? parsed.map((line) => line.text)
        : plain
          ? plain.split('\n').filter((line) => line.trim().length > 0).slice(0, 120)
          : [];

      // Show the base lyrics immediately. Transliteration and translation are
      // optional enhancements and run concurrently in the background.
      setActiveTrackLyrics({
        syncedLyrics: synced,
        plainLyrics: plain,
        englishLyrics: null,
        translations: [],
        source,
        provider,
        hasAlternateLanguage,
        loading: false,
      });

      if (lyricLines.length === 0) return;

      const transliterationTask = async (): Promise<{
        transliteration?: string[];
        hasAlternateLanguage?: boolean;
      } | null> => {
        if (settings.lyricsLanguage !== 'ENGLISH' || !containsNonLatin) return null;
        try {
          const response = await apiFetch('/api/transliterate-lyrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lines: lyricLines,
              targetLang: 'en',
            }),
            signal: controller.signal,
          });
          if (!response.ok) return null;
          return (await response.json()) as {
            transliteration?: string[];
            hasAlternateLanguage?: boolean;
          };
        } catch {
          return null;
        }
      };

      const translationTask = async (): Promise<string[]> => {
        if (!settings.showSyncedLyricsTranslation || !synced || parsed.length === 0) {
          return [];
        }
        try {
          const targetIso = LANG_ISO_MAP[settings.translationLanguage] || 'en';
          const response = await apiFetch('/api/translate-lyrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lines: parsed.map((line) => line.text),
              targetLang: targetIso,
            }),
            signal: controller.signal,
          });
          if (!response.ok) return [];
          const data = (await response.json()) as { translations?: string[] };
          return data.translations || [];
        } catch {
          return [];
        }
      };

      const transliterationPromise = transliterationTask().then((result) => {
        if (!isCurrentRequest() || !result) return result;
        if (typeof result.hasAlternateLanguage === 'boolean') {
          hasAlternateLanguage = result.hasAlternateLanguage;
        }
        // Apply transliteration as soon as it is ready. Translation is an
        // unrelated request and must not delay English-mode lyrics.
        setActiveTrackLyrics((previous) => ({
          ...previous,
          englishLyrics: result.transliteration || null,
          hasAlternateLanguage,
        }));
        return result;
      });
      const translationPromise = translationTask().then((translations) => {
        if (!isCurrentRequest()) return translations;
        setActiveTrackLyrics((previous) => ({
          ...previous,
          translations,
        }));
        return translations;
      });

      const [transliteration, translations] = await Promise.all([
        transliterationPromise,
        translationPromise,
      ]);
      if (!isCurrentRequest()) return;

      if (typeof transliteration?.hasAlternateLanguage === 'boolean') {
        hasAlternateLanguage = transliteration.hasAlternateLanguage;
      }
      setActiveTrackLyrics((previous) => ({
        ...previous,
        englishLyrics: transliteration?.transliteration || null,
        translations,
        hasAlternateLanguage,
      }));
    },
    [
      queueNextResult?.lyricsBrowseId,
      queueNextResult?.sourceVideoId,
      settings.contentLanguage,
      settings.contentRegion,
      settings.lyricsLanguage,
      settings.lyricsProviders,
      settings.showSyncedLyricsTranslation,
      settings.translationLanguage,
    ],
  );

  useEffect(() => {
    if (!currentTrack) {
      lyricsRequestIdRef.current += 1;
      lyricsAbortRef.current?.abort();
      setActiveTrackLyrics({
        syncedLyrics: null,
        plainLyrics: null,
        englishLyrics: null,
        translations: [],
        source: null,
        provider: null,
        hasAlternateLanguage: false,
        loading: false,
      });
      return undefined;
    }
    void fetchLyricsForTrack(currentTrack);
    return () => {
      lyricsRequestIdRef.current += 1;
      lyricsAbortRef.current?.abort();
    };
  }, [currentTrack, fetchLyricsForTrack]);

  // Warm the next track's lyrics after a short idle period. The service
  // coalesces duplicate requests and persists successful results, so the next
  // song can render instantly without adding work to the current track.
  useEffect(() => {
    const upcoming = queue[queueIndex + 1];
    if (
      !upcoming ||
      upcoming.source !== 'ytmusic' ||
      upcoming.syncedLyrics ||
      upcoming.plainLyrics
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void lyricsService
        .fetchLyrics({
          title: upcoming.title,
          artist: upcoming.artist,
          videoId: upcoming.ytMusicVideoId,
          duration: upcoming.durationSec,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
          providers: settings.lyricsProviders,
        })
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    queue,
    queueIndex,
    settings.contentLanguage,
    settings.contentRegion,
    settings.lyricsProviders,
  ]);

  const refreshCurrentLyrics = useCallback(async () => {
    if (currentTrack) {
      await fetchLyricsForTrack(currentTrack, { forceRefresh: true });
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
      const requestId = ++queueNextRequestIdRef.current;
      const requestEpoch = accountEpochRef.current;
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
      if (
        requestId !== queueNextRequestIdRef.current ||
        requestEpoch !== accountEpochRef.current
      ) {
        return [];
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
        if (
          requestId !== queueNextRequestIdRef.current ||
          requestEpoch !== accountEpochRef.current
        ) {
          return [];
        }
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
        if (requestId === queueNextRequestIdRef.current) {
          setQueueNextLoading(false);
        }
      }
    },
    [settings.contentLanguage, settings.contentRegion],
  );

  useEffect(() => {
    fetchQueueNextRef.current = fetchQueueNext;
  }, [fetchQueueNext]);

  const loadMoreQueueNext = useCallback(async (): Promise<Track[]> => {
    if (queueNextLoading || !queueUnlimitedRef.current) return [];
    const currentCont = queueNextResult?.continuation;

    if (!currentCont) {
      const seed = queueRef.current[queueRef.current.length - 1] || currentTrack;
      if (!seed) return [];
      return await fetchQueueNext(seed.ytMusicVideoId, undefined, undefined, true, {
        title: seed.title,
        artist: seed.artist,
      });
    }

    const requestId = ++queueNextRequestIdRef.current;
    const requestEpoch = accountEpochRef.current;
    setQueueNextLoading(true);
    try {
      const data = await ytmClient.getQueueNext({
        continuation: currentCont,
        gl: settings.contentRegion || 'US',
        hl: settings.contentLanguage || 'en',
      });
      if (
        requestId !== queueNextRequestIdRef.current ||
        requestEpoch !== accountEpochRef.current
      ) {
        return [];
      }
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
      if (requestId === queueNextRequestIdRef.current) {
        setQueueNextLoading(false);
      }
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
    async (track: Track, newQueue?: Track[], options?: PlayQueueModeOptions) => {
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

      const hasExplicitQueue = Boolean(newQueue && newQueue.length > 0);
      const isUnlimitedQueue = shouldUseUnlimitedQueue(
        hasExplicitQueue,
        options,
        queueUnlimitedRef.current,
      );
      queueUnlimitedRef.current = isUnlimitedQueue;
      if (!isUnlimitedQueue) {
        queueNextRequestIdRef.current += 1;
        setQueueNextResult(null);
      }

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

        // Fetch YouTube Music "Up Next" queue only for non-playlist/non-library (unlimited) playback
        if (isUnlimitedQueue && resolvedTrack.source === 'ytmusic' && resolvedTrack.ytMusicVideoId) {
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

  // Auto-prefetch next radio page when user reaches within 3 tracks of queue end (unlimited mode only)
  useEffect(() => {
    if (!currentTrack || queue.length === 0 || !queueUnlimitedRef.current) return;
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
      } else if (queueUnlimitedRef.current) {
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
      } else {
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

      const desiredState = likeDesiredStateRef.current.get(trackId);
      const previousYtmLikedIds = new Set(ytmLikedTrackIdsRef.current);
      const previousLocalLikedIds = new Set(localLikedTrackIdsRef.current);
      const wasRemotelyLiked = previousYtmLikedIds.has(trackId);
      const wasLocallyLiked = previousLocalLikedIds.has(trackId);
      const currentlyLiked =
        desiredState ?? (wasRemotelyLiked || wasLocallyLiked || isTrackLiked(trackId));
      const nextLiked = !currentlyLiked;
      const mutationVersion = (likeMutationVersionRef.current.get(trackId) || 0) + 1;
      likeMutationVersionRef.current.set(trackId, mutationVersion);
      likeDesiredStateRef.current.set(trackId, nextLiked);

      const nextYtmLikedIds = new Set(previousYtmLikedIds);
      const nextLocalLikedIds = new Set(previousLocalLikedIds);
      if (nextLiked) {
        nextLocalLikedIds.add(trackId);
      } else {
        nextYtmLikedIds.delete(trackId);
        nextLocalLikedIds.delete(trackId);
      }

      const targetVideoId =
        trackData?.ytMusicVideoId ||
        tracks.find((t) => t.id === trackId)?.ytMusicVideoId ||
        (currentTrack?.id === trackId ? currentTrack.ytMusicVideoId : undefined);
      const canSyncRemotely = Boolean(ytAuthStatus?.loggedIn && targetVideoId);
      const requestAccountId = ytAuthStatus?.activeAccountId || null;
      const requestEpoch = accountEpochRef.current;

      if (nextLiked && canSyncRemotely) {
        // The remote set is authoritative for tracks that can be represented in
        // YouTube Music. A local/Spotify like remains in its own set.
        nextYtmLikedIds.add(trackId);
        nextLocalLikedIds.delete(trackId);
      }
      commitLikedTrackSets(nextYtmLikedIds, nextLocalLikedIds);

      if (!canSyncRemotely) {
        if (ytAuthStatus?.loggedIn && nextLiked && !targetVideoId) {
          showToast(
            'Saved locally. This track has no YouTube Music video ID to synchronize.',
            'info',
          );
        }
        return;
      }

      const shouldSyncRemotely = nextLiked || wasRemotelyLiked;
      if (!shouldSyncRemotely) return;

      const rollback = () => {
        if (likeMutationVersionRef.current.get(trackId) !== mutationVersion) return;
        if (
          requestEpoch !== accountEpochRef.current ||
          (ytAuthStatusRef.current?.activeAccountId || null) !== requestAccountId
        ) {
          return;
        }
        likeDesiredStateRef.current.set(trackId, currentlyLiked);
        commitLikedTrackSets(previousYtmLikedIds, previousLocalLikedIds);
        showToast('Could not update the liked song in YouTube Music.', 'error');
      };

      void ytmClient
        .likeYtmTrack(
          targetVideoId as string,
          nextLiked,
          settings.contentRegion || 'US',
          settings.contentLanguage || 'en',
          requestAccountId,
        )
        .then((result) => {
          if (!result.ok) rollback();
        })
        .catch(rollback);
    },
    [
      commitLikedTrackSets,
      currentTrack,
      ensureTrackInStore,
      isTrackLiked,
      settings.contentLanguage,
      settings.contentRegion,
      showToast,
      tracks,
      ytAuthStatus?.activeAccountId,
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
        const requestAccountId = ytAuthStatusRef.current?.activeAccountId || null;
        void apiFetch('/api/ytmusic/edit-playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playlistId: targetPl.ytBrowseId,
            videoId: track.ytMusicVideoId,
            gl: settings.contentRegion || 'US',
            hl: settings.contentLanguage || 'en',
            expectedAccountId: requestAccountId,
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
      libraryTracks?: Track[];
      playlists?: Array<{
        browseId: string;
        playlistId?: string;
        title: string;
        subtitle?: string;
        thumbnailUrl?: string;
        tracks?: Track[];
        tracksComplete?: boolean;
        tracksIncompleteReason?: string;
      }>;
      complete?: boolean;
      playlistsComplete?: boolean;
      incompleteReason?: string;
      savedAlbums?: YtMusicBrowseItem[];
      followedArtists?: YtMusicBrowseItem[];
      uploadedTracks?: Track[];
      historyTracks?: Track[];
      syncedAt?: number;
      accountId?: string | null;
    }, accountId: string) => {
      const scopeRemoteTrack = (track: Track): Track => ({
        ...track,
        ytAccountId: accountId,
      });
      const liked = (data.likedTracks || []).map((t) => ({
        ...scopeRemoteTrack(t),
        liked: true,
      }));
      const remoteLikedIds = liked.map((track) => track.id);
      const localLikedIds = Array.from(localLikedTrackIdsRef.current);
      const aggregateLikedIds = mergeLikedTrackIds(remoteLikedIds, localLikedIds);
      const libraryTracks = (data.libraryTracks || []).map(scopeRemoteTrack);
      const uploads = (data.uploadedTracks || []).map(scopeRemoteTrack);
      const history = (data.historyTracks || []).map(scopeRemoteTrack);
      const cloudPls = data.playlists || [];

      const allToStore: Track[] = [...liked, ...libraryTracks, ...uploads, ...history];
      for (const cpl of cloudPls) {
        if (cpl.tracks?.length) allToStore.push(...cpl.tracks.map(scopeRemoteTrack));
      }

      const independentTrackIds = collectIndependentYtTrackIds(
        playlistsRef.current,
        localLikedIds,
      );
      setTracks((prev) => {
        // A complete snapshot replaces the selected account's remote track
        // cache. Independent local/Spotify references are retained so stale
        // remote rows cannot keep deleted songs alive indefinitely.
        const retained = prev.flatMap((track) => {
          if (track.source !== 'ytmusic') return [track];
          if (!independentTrackIds.has(track.id)) return [];
          const independentTrack = { ...track };
          delete independentTrack.ytAccountId;
          return [independentTrack];
        });
        const map = new Map(retained.map((t) => [t.id, t]));
        for (const t of allToStore) {
          const existing = map.get(t.id);
          const merged = existing ? { ...existing, ...t } : t;
          // A track referenced by an independent playlist/local like remains
          // independent even when the same video is also in this account's
          // authoritative remote snapshot.
          if (independentTrackIds.has(merged.id)) {
            delete merged.ytAccountId;
          }
          map.set(merged.id, merged);
        }
        // The remote YTM liked set is authoritative within its own source, but
        // it cannot erase independent local or Spotify likes.
        return applyLikedTrackIdsToTracks(Array.from(map.values()), aggregateLikedIds);
      });
      commitLikedTrackSets(remoteLikedIds, localLikedIds, false);

      setPlaylists((prev) =>
        mergeSyncedYtPlaylists(prev, cloudPls, data.playlistsComplete),
      );

      setYtSavedAlbums(data.savedAlbums || []);
      setYtFollowedArtists(data.followedArtists || []);
      setYtUploadedTracks(data.uploadedTracks || []);
      setYtHistoryTracks(data.historyTracks || []);
      setLastLibrarySyncAt(data.syncedAt || null);
    },
    [commitLikedTrackSets],
  );

  const syncYtMusicLibrary = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const requestAccountId = ytAuthStatusRef.current?.activeAccountId || null;
    const requestEpoch = accountEpochRef.current;
    const requestId = ++librarySyncRequestIdRef.current;
    if (!requestAccountId) {
      const message = 'Sign in to YouTube Music before synchronizing the library.';
      showToast(message, 'error');
      return { ok: false, message };
    }

    try {
      const data = await ytmClient.syncYtmLibrary(
        settings.contentRegion || 'US',
        settings.contentLanguage || 'en',
      );
      const isCurrentRequest =
        requestId === librarySyncRequestIdRef.current &&
        requestEpoch === accountEpochRef.current &&
        (ytAuthStatusRef.current?.activeAccountId || null) === requestAccountId;
      if (!isCurrentRequest) {
        return {
          ok: false,
          message: 'Ignored a stale library sync from a different YouTube Music account.',
        };
      }
      if (!isAuthoritativeYtLibrarySnapshot(data)) {
        const message =
          data.incompleteReason ||
          data.error ||
          'Library sync was incomplete; no partial snapshot was applied.';
        showToast(message, 'error');
        return { ok: false, message };
      }
      if (data.accountId !== requestAccountId) {
        return {
          ok: false,
          message: 'Ignored a stale library sync from a different YouTube Music account.',
        };
      }
      applySyncedYtLibraryPayload(data, requestAccountId);
      const liked = data.likedTracks?.length || 0;
      const library = data.libraryTracks?.length || 0;
      const pls = data.playlists?.length || 0;
      const albums = data.savedAlbums?.length || 0;
      showToast(
        `Synced ${liked} liked songs, ${library} library songs, ${pls} playlists, and ${albums} albums`,
      );
      return {
        ok: true,
        message: `Synced ${liked} liked tracks, ${library} library tracks, ${pls} playlists, and ${albums} albums.`,
      };
    } catch (err) {
      if (
        requestId !== librarySyncRequestIdRef.current ||
        requestEpoch !== accountEpochRef.current
      ) {
        return { ok: false, message: 'Ignored a stale library sync failure.' };
      }
      const message =
        err instanceof Error && err.message
          ? `Library sync failed: ${err.message}`
          : 'Library sync failed due to network error.';
      showToast(message, 'error');
      return { ok: false, message };
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

  // Restore the complete library after startup/account restoration. The main
  // process coalesces duplicate account-scoped requests, so this remains safe
  // when sign-in also starts an immediate synchronization.
  useEffect(() => {
    if (!proxyReady || !ytAuthStatus?.loggedIn || !ytAuthStatus.activeAccountId) {
      return;
    }
    void syncYtMusicLibraryRef.current?.();
  }, [proxyReady, ytAuthStatus?.activeAccountId, ytAuthStatus?.loggedIn]);

  const signInWithYouTubeMusic = useCallback(
    async (options?: {
      cleanPartition?: boolean;
    }): Promise<{
      ok: boolean;
      blocked?: boolean;
      cancelled?: boolean;
      retryable?: boolean;
      message: string;
    }> => {
      setSigningInYtMusic(true);
      setYtLoginError(null);
      setYtLoginRetryable(false);
      setYtLoginBlocked(false);
      ytLoginOptionsRef.current = options;
      const mutationVersion = ++accountMutationVersionRef.current;
      setYtAccountMutationPending(true);
      try {
        const res = await ytmClient.loginYtm(options);
        if (mutationVersion !== accountMutationVersionRef.current) {
          return { ok: false, cancelled: true, message: '' };
        }
        if (res.cancelled) {
          // User closed the login window (X or Cancel). Reset to "Sign in"
          // without showing an error; signingInYtMusic is reset in finally.
          return { ok: false, cancelled: true, message: '' };
        }
        if (!res.ok) {
          const msg =
            res.error || 'YouTube Music sign-in did not complete.';
          setYtLoginError(res.warning ? `${msg} ${res.warning}` : msg);
          setYtLoginRetryable(res.retryable === true);
          setYtLoginBlocked(res.blocked === true);
          if (!msg.toLowerCase().includes('closed')) {
            showToast(res.warning ? `${msg} ${res.warning}` : msg, 'error');
          }
          return {
            ok: false,
            blocked: res.blocked,
            retryable: res.retryable,
            message: msg,
          };
        }

        if (!res.status?.loggedIn || !res.status.activeAccountId) {
          throw new Error('YouTube Music sign-in completed without a verified account.');
        }
        applyAuthoritativeYtStatus(res.status);
        const name = res.status.accountName || 'YouTube Music User';
        setYtLoginError(null);
        setYtLoginRetryable(false);
        setYtLoginBlocked(false);
        showToast(`Signed in to YouTube Music as ${name}. Syncing library...`);
        if (res.warning) showToast(res.warning, 'info');
        // Persist the sanitized auth summary for a flicker-free startup. The
        // encrypted vault remains the source of truth for actual credentials.
        if (res.status) {
          try {
            localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(res.status));
          } catch {
            // ignore
          }
        }
        await syncYtMusicLibraryRef.current?.();
        return { ok: true, message: `Signed in as ${name}` };
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Could not open YouTube Music sign-in.';
        setYtLoginError(msg);
        setYtLoginRetryable(true);
        setYtLoginBlocked(false);
        showToast(msg, 'error');
        return { ok: false, retryable: true, message: msg };
      } finally {
        setSigningInYtMusic(false);
        if (mutationVersion === accountMutationVersionRef.current) {
          setYtAccountMutationPending(false);
        }
      }
    },
    [applyAuthoritativeYtStatus, showToast],
  );

  const retryYtMusicSignIn = useCallback(async () => {
    return await signInWithYouTubeMusic(ytLoginOptionsRef.current);
  }, [signInWithYouTubeMusic]);

  const resetYtVault = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    accountMutationVersionRef.current += 1;
    const result = await ytmClient.resetYtmVault();
    if (!result.ok) {
      const message = result.error || 'Could not reset the encrypted YouTube Music session vault.';
      setYtVaultDiagnostic({ error: message, unreadableFile: true });
      showToast(message, 'error');
      return { ok: false, message };
    }

    setYtVaultDiagnostic(null);
    setYtLoginError(null);
    setYtLoginRetryable(false);
    setYtLoginBlocked(false);
    try {
      const status = await ytmClient.getYtmStatus();
      applyAuthoritativeYtStatus(status);
      try {
        if (status.loggedIn) {
          localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(status));
        } else {
          localStorage.removeItem(YT_AUTH_LOCAL_KEY);
        }
      } catch {
        // The encrypted vault remains authoritative if the optimistic backup
        // cannot be written.
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'The vault was reset, but its sign-in status could not be verified.';
      setYtVaultDiagnostic({ error: message, unreadableFile: true });
      showToast(message, 'error');
      return { ok: false, message };
    }
    showToast('Encrypted session vault reset. The previous file was backed up.');
    return { ok: true, message: 'Encrypted session vault reset.' };
  }, [applyAuthoritativeYtStatus, showToast]);

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
      const mutationVersion = ++accountMutationVersionRef.current;
      setYtAccountMutationPending(true);
      try {
        const res = await ytmClient.importYtmBrowserSession(payload);
        if (mutationVersion !== accountMutationVersionRef.current) {
          return { ok: false, message: 'Ignored a stale browser-session import.' };
        }
        if (
          !res.ok ||
          !res.status?.loggedIn ||
          !res.status.activeAccountId
        ) {
          const msg = res.error || 'Could not validate YouTube Music session.';
          showToast(msg, 'error');
          return { ok: false, message: msg };
        }
        applyAuthoritativeYtStatus(res.status);
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
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Failed to import browser session.';
        showToast(message, 'error');
        return { ok: false, message };
      } finally {
        setSigningInYtMusic(false);
        if (mutationVersion === accountMutationVersionRef.current) {
          setYtAccountMutationPending(false);
        }
      }
    },
    [applyAuthoritativeYtStatus, showToast],
  );

  const switchYtAccount = useCallback(
    async (accountId: string) => {
      const knownAccounts = ytAuthStatusRef.current?.accounts || [];
      if (!knownAccounts.some((account) => account.id === accountId)) {
        showToast('Could not switch YouTube Music account: the account no longer exists.', 'error');
        return;
      }
      const mutationVersion = ++accountMutationVersionRef.current;
      setYtAccountMutationPending(true);
      try {
        const nextStatus = await ytmClient.switchYtmAccount(accountId);
        if (mutationVersion !== accountMutationVersionRef.current) return;
        if (
          !nextStatus.loggedIn ||
          nextStatus.activeAccountId !== accountId ||
          !nextStatus.accounts?.some((account) => account.id === accountId)
        ) {
          throw new Error('The requested YouTube Music account could not be activated.');
        }
        applyAuthoritativeYtStatus(nextStatus);
        // Persist auth status to localStorage backup after account switch.
        try {
          localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(nextStatus));
        } catch {
          // ignore
        }
        showToast(`Switched to ${nextStatus.accountName || 'YouTube Music account'}`);
        await syncYtMusicLibraryRef.current?.();
      } catch (err) {
        if (mutationVersion !== accountMutationVersionRef.current) return;
        const message =
          err instanceof Error && err.message
            ? `Could not switch YouTube Music account: ${err.message}`
            : 'Could not switch YouTube Music account.';
        showToast(message, 'error');
      } finally {
        if (mutationVersion === accountMutationVersionRef.current) {
          setYtAccountMutationPending(false);
        }
      }
    },
    [applyAuthoritativeYtStatus, showToast],
  );

  const signOutYtAccount = useCallback(
    async (accountId?: string) => {
      const activeBeforeId = ytAuthStatusRef.current?.activeAccountId || null;
      if (
        accountId &&
        !ytAuthStatusRef.current?.accounts?.some((account) => account.id === accountId)
      ) {
        showToast('Could not sign out of YouTube Music: the account no longer exists.', 'error');
        return;
      }
      const mutationVersion = ++accountMutationVersionRef.current;
      setYtAccountMutationPending(true);
      try {
        const nextStatus = await ytmClient.logoutYtmAccount(accountId);
        if (mutationVersion !== accountMutationVersionRef.current) return;
        applyAuthoritativeYtStatus(nextStatus);
        // Keep only a sanitized summary when another account remains active.
        try {
          if (nextStatus.loggedIn) {
            localStorage.setItem(YT_AUTH_LOCAL_KEY, JSON.stringify(nextStatus));
          } else {
            localStorage.removeItem(YT_AUTH_LOCAL_KEY);
          }
        } catch {
          // ignore
        }
        const activeAccountChanged =
          activeBeforeId !== (nextStatus.activeAccountId || null);
        if (activeAccountChanged && nextStatus.loggedIn) {
          await syncYtMusicLibraryRef.current?.();
        }
        showToast(nextStatus.loggedIn ? `Switched to ${nextStatus.accountName}` : 'Signed out of YouTube Music');
      } catch (err) {
        if (mutationVersion !== accountMutationVersionRef.current) return;
        const message =
          err instanceof Error && err.message
            ? `Could not sign out of YouTube Music: ${err.message}`
            : 'Could not sign out of YouTube Music.';
        showToast(message, 'error');
      } finally {
        if (mutationVersion === accountMutationVersionRef.current) {
          setYtAccountMutationPending(false);
        }
      }
    },
    [applyAuthoritativeYtStatus, showToast],
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
      
      setSpotifySyncProgress({
        phase: 'fetching',
        message: 'Fetching liked songs and playlists from Spotify...',
        completed: 0,
        total: 100,
        inProgress: true,
      });

      const progressPoller = window.setInterval(() => {
        void ytmClient.getSpotifySyncProgress().then((p) => {
          if (p && p.inProgress) {
            setSpotifySyncProgress(p);
          }
        });
      }, 350);

      try {
        const data = await ytmClient.syncSpotify(
          settings.contentRegion || 'US',
          settings.contentLanguage || 'en',
        );
        window.clearInterval(progressPoller);
        
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

        // Spotify imports are independent user state even though they resolve
        // to playable YouTube Music tracks. Do not assign them to the active
        // YouTube Music account or they would be removed on an account switch.
        const toIndependentSpotifyTrack = (track: Track): Track => {
          const independentTrack = { ...track };
          delete independentTrack.ytAccountId;
          return independentTrack;
        };
        const liked = (data.likedTracks || []).map((t) => ({
          ...toIndependentSpotifyTrack(t),
          liked: true,
        }));
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
          if (spPl.tracks?.length) {
            allIncoming.push(...spPl.tracks.map(toIndependentSpotifyTrack));
          }
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

        const nextLocalLikedIds = new Set(localLikedTrackIdsRef.current);
        for (const track of liked) nextLocalLikedIds.add(track.id);
        commitLikedTrackSets(ytmLikedTrackIdsRef.current, nextLocalLikedIds);

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
        window.clearInterval(progressPoller);
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
        window.clearInterval(progressPoller);
        setSpotifySyncing(false);
        // Clear progress after a delay
        setTimeout(() => {
          setSpotifySyncProgress(null);
        }, 5000);
      }
    },
    [
      commitLikedTrackSets,
      settings.contentLanguage,
      settings.contentRegion,
      showToast,
      spotifySyncing,
    ],
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

  const toggleLyricsLanguage = useCallback(() => {
    updateSettings({
      lyricsLanguage: settings.lyricsLanguage === 'ENGLISH' ? 'NATIVE' : 'ENGLISH',
    });
  }, [settings.lyricsLanguage, updateSettings]);

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
        activeYtAccountId: ytAuthVerified
          ? ytAuthStatus?.activeAccountId || null
          : null,
        spotifyConnection,
        ytSavedAlbums,
        ytFollowedArtists,
        ytUploadedTracks,
        ytHistoryTracks,
        ytmLikedTrackIds,
        localLikedTrackIds,
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
    ytAuthVerified,
    spotifyConnection,
    ytmLikedTrackIds,
    localLikedTrackIds,
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
          activeYtAccountId?: string | null;
          spotifyConnection?: SpotifyConnection | null;
          ytSavedAlbums?: YtMusicBrowseItem[];
          ytFollowedArtists?: YtMusicBrowseItem[];
          ytUploadedTracks?: Track[];
          ytHistoryTracks?: Track[];
          ytmLikedTrackIds?: string[];
          localLikedTrackIds?: string[];
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
        const importedTracks = Array.isArray(parsed.tracks) ? parsed.tracks : null;
        const importedPlaylists = Array.isArray(parsed.playlists) ? parsed.playlists : null;
        const activeAccountId =
          ytAuthVerified && ytAuthStatusRef.current?.loggedIn
            ? ytAuthStatusRef.current.activeAccountId || null
            : null;
        // Legacy backups did not persist an explicit library owner. Their
        // remote state is not safe to restore under a different account.
        const backupAccountId = parsed.activeYtAccountId || null;
        const accountMatches = isPersistedYtAccountMatch(
          activeAccountId,
          backupAccountId,
        );

        let likedSets = {
          ytmLikedIds: [] as string[],
          localLikedIds: [] as string[],
        };
        if (importedTracks || importedPlaylists) {
          const importedLikedIds =
            importedPlaylists?.find((playlist) => playlist.id === 'pl-liked')?.trackIds || [];
          likedSets = deriveLikedTrackSets({
            persistedLikedIds: importedLikedIds,
            persistedYtmLikedIds: parsed.ytmLikedTrackIds,
            persistedLocalLikedIds: parsed.localLikedTrackIds,
            tracks: importedTracks || [],
            playlists: importedPlaylists || [],
          });
          const independentTrackIds = collectIndependentYtTrackIds(
            importedPlaylists || [],
            likedSets.localLikedIds,
          );
          const accountCandidate =
            accountMatches && activeAccountId
              ? tagYtMusicTracksForAccount(
                  importedTracks || [],
                  activeAccountId,
                  independentTrackIds,
                )
              : importedTracks || [];
          const scopedTracks = scopeYtMusicTracksToAccount(
            accountCandidate,
            activeAccountId,
            independentTrackIds,
          );
          const scopedPlaylists = accountMatches
            ? importedPlaylists || []
            : (importedPlaylists || []).filter((playlist) => !playlist.ytBrowseId);
          const authorizedYtmLikedIds = accountMatches ? likedSets.ytmLikedIds : [];
          const aggregateLikedIds = mergeLikedTrackIds(
            authorizedYtmLikedIds,
            likedSets.localLikedIds,
          );

          if (importedTracks) {
            setTracks(applyLikedTrackIdsToTracks(scopedTracks, aggregateLikedIds));
          }
          if (importedPlaylists) setPlaylists(scopedPlaylists);
          commitLikedTrackSets(authorizedYtmLikedIds, likedSets.localLikedIds);
        }
        if (Array.isArray(parsed.tags)) setTags(parsed.tags);
        if (Array.isArray(parsed.playEvents)) setPlayEvents(parsed.playEvents);
        if (Array.isArray(parsed.searchHistory)) setSearchHistory(parsed.searchHistory);
        // Authentication is intentionally not restored from a backup. The
        // encrypted vault on this device owns the session cookies and remains
        // the only source of truth for a signed-in YouTube Music account.
        if (parsed.spotifyConnection) setSpotifyConnection(parsed.spotifyConnection);
        setYtSavedAlbums(
          accountMatches && Array.isArray(parsed.ytSavedAlbums)
            ? parsed.ytSavedAlbums
            : [],
        );
        setYtFollowedArtists(
          accountMatches && Array.isArray(parsed.ytFollowedArtists)
            ? parsed.ytFollowedArtists
            : [],
        );
        setYtUploadedTracks(
          accountMatches && Array.isArray(parsed.ytUploadedTracks)
            ? parsed.ytUploadedTracks
            : [],
        );
        setYtHistoryTracks(
          accountMatches && Array.isArray(parsed.ytHistoryTracks)
            ? parsed.ytHistoryTracks
            : [],
        );
        showToast(
          'Backup restored successfully (YouTube Music sessions remain managed by this device)',
        );
        return { ok: true, message: 'Backup restored successfully.' };
      } catch {
        return { ok: false, message: 'Could not parse backup JSON.' };
      }
    },
    [commitLikedTrackSets, showToast, ytAuthVerified],
  );

  // Broadcast playback state for standalone Electron Always-On-Top Mini-Player window
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(MINI_OVERLAY_CHANNEL);
    miniOverlayPublisherRef.current = ch;
    return () => {
      if (miniOverlayPublisherRef.current === ch) miniOverlayPublisherRef.current = null;
      ch.close();
    };
  }, []);

  useEffect(() => {
    const ch = miniOverlayPublisherRef.current;
    if (!ch) return;

    // Compute current synced lyric line
    const parsedLyrics = parseLrcLyrics(activeTrackLyrics.syncedLyrics);
    const activeLyricIdx = findActiveLyricIndex(
      parsedLyrics,
      positionSec * 1000,
      settings.lyricsOffsetMs,
    );
    const nativeLine = activeLyricIdx >= 0 ? parsedLyrics[activeLyricIdx]?.text : null;
    const activeLyricLine =
      settings.lyricsLanguage === 'ENGLISH' && activeTrackLyrics.englishLyrics?.[activeLyricIdx]
        ? activeTrackLyrics.englishLyrics[activeLyricIdx]
        : nativeLine;
    const hasSyncedLyrics = Boolean(
      activeTrackLyrics.syncedLyrics && activeTrackLyrics.syncedLyrics.trim().length > 0
    );
    const hasAlternateLanguage = Boolean(
      activeTrackLyrics.hasAlternateLanguage ||
        (activeTrackLyrics.englishLyrics && activeTrackLyrics.englishLyrics.length > 0),
    );

    ch.postMessage({
      type: 'STATE',
      payload: {
        currentTrack,
        liked: currentTrack ? isTrackLiked(currentTrack.id) : false,
        isPlaying,
        positionSec,
        durationSec,
        repeatMode,
        shuffleEnabled,
        volume: settings.volume,
        miniOverlayTheme: settings.miniOverlayTheme,
        sliderStyle: settings.sliderStyle,
        themeSeedColor: effectiveThemeColor,
        darkMode: settings.darkMode,
        pureBlack: settings.pureBlack,
        themeSurfaceStyle: settings.themeSurfaceStyle,
        activeLyricLine,
        lyricsLanguage: settings.lyricsLanguage,
        hasAlternateLanguage,
        hasSyncedLyrics,
      },
    });
  }, [
    currentTrack,
    isTrackLiked,
    durationSec,
    isPlaying,
    positionSec,
    repeatMode,
    shuffleEnabled,
    settings.darkMode,
    settings.miniOverlayTheme,
    settings.sliderStyle,
    effectiveThemeColor,
    settings.themeSurfaceStyle,
    settings.pureBlack,
    settings.volume,
    settings.lyricsLanguage,
    activeTrackLyrics.syncedLyrics,
    activeTrackLyrics.englishLyrics,
    activeTrackLyrics.hasAlternateLanguage,
    settings.lyricsOffsetMs,
  ]);

  const miniCommandStateRef = useRef({
    currentTrack,
    isTrackLiked,
    toggleLike,
    isPlaying,
    durationSec,
    repeatMode,
    shuffleEnabled,
    volume: settings.volume,
    miniOverlayTheme: settings.miniOverlayTheme,
    sliderStyle: settings.sliderStyle,
    themeSeedColor: effectiveThemeColor,
    darkMode: settings.darkMode,
    pureBlack: settings.pureBlack,
    themeSurfaceStyle: settings.themeSurfaceStyle,
    lyricsLanguage: settings.lyricsLanguage,
    lyricsOffsetMs: settings.lyricsOffsetMs,
    syncedLyrics: activeTrackLyrics.syncedLyrics,
    englishLyrics: activeTrackLyrics.englishLyrics,
    hasAlternateLanguage: activeTrackLyrics.hasAlternateLanguage,
    closeMiniPlayer,
    togglePlayPause,
    nextTrack,
    prevTrack,
    toggleLyricsLanguage,
    seekTo,
    toggleShuffle,
    cycleRepeatMode,
    updateSettings,
    toggleRightPanel,
  });
  miniCommandStateRef.current = {
    currentTrack,
    isTrackLiked,
    toggleLike,
    isPlaying,
    durationSec,
    repeatMode,
    shuffleEnabled,
    volume: settings.volume,
    miniOverlayTheme: settings.miniOverlayTheme,
    sliderStyle: settings.sliderStyle,
    themeSeedColor: effectiveThemeColor,
    darkMode: settings.darkMode,
    pureBlack: settings.pureBlack,
    themeSurfaceStyle: settings.themeSurfaceStyle,
    lyricsLanguage: settings.lyricsLanguage,
    lyricsOffsetMs: settings.lyricsOffsetMs,
    syncedLyrics: activeTrackLyrics.syncedLyrics,
    englishLyrics: activeTrackLyrics.englishLyrics,
    hasAlternateLanguage: activeTrackLyrics.hasAlternateLanguage,
    closeMiniPlayer,
    togglePlayPause,
    nextTrack,
    prevTrack,
    toggleLyricsLanguage,
    seekTo,
    toggleShuffle,
    cycleRepeatMode,
    updateSettings,
    toggleRightPanel,
  };

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(MINI_OVERLAY_CHANNEL);
    ch.onmessage = (e: MessageEvent<{
      type?: string;
      action?: string;
      positionSec?: number;
      volume?: number;
    }>) => {
      const state = miniCommandStateRef.current;
      if (e.data?.type === 'REQUEST_STATE') {
        // Use the latest playback position without recreating the command channel.
        const parsedLyrics = parseLrcLyrics(state.syncedLyrics);
        const activeLyricIdx = findActiveLyricIndex(
          parsedLyrics,
          positionSecRef.current * 1000,
          state.lyricsOffsetMs,
        );
        const nativeLine = activeLyricIdx >= 0 ? parsedLyrics[activeLyricIdx]?.text : null;
        const activeLyricLine =
          state.lyricsLanguage === 'ENGLISH' && state.englishLyrics?.[activeLyricIdx]
            ? state.englishLyrics[activeLyricIdx]
            : nativeLine;
        const hasSyncedLyrics = Boolean(
          state.syncedLyrics && state.syncedLyrics.trim().length > 0
        );
        const hasAlternateLanguage = Boolean(
          state.hasAlternateLanguage ||
            (state.englishLyrics && state.englishLyrics.length > 0),
        );

        ch.postMessage({
          type: 'STATE',
          payload: {
            currentTrack: state.currentTrack,
            liked: state.currentTrack ? state.isTrackLiked(state.currentTrack.id) : false,
            isPlaying: state.isPlaying,
            positionSec: positionSecRef.current,
            durationSec: state.durationSec,
            repeatMode: state.repeatMode,
            shuffleEnabled: state.shuffleEnabled,
            volume: state.volume,
            miniOverlayTheme: state.miniOverlayTheme,
            sliderStyle: state.sliderStyle,
            themeSeedColor: state.themeSeedColor,
            darkMode: state.darkMode,
            pureBlack: state.pureBlack,
            themeSurfaceStyle: state.themeSurfaceStyle,
            activeLyricLine,
            lyricsLanguage: state.lyricsLanguage,
            hasAlternateLanguage,
            hasSyncedLyrics,
          },
        });
      } else if (e.data?.type === 'CMD') {
        if (e.data.action === 'toggle') void state.togglePlayPause();
        if (e.data.action === 'next') void state.nextTrack();
        if (e.data.action === 'prev') void state.prevTrack();
        if (e.data.action === 'toggleLyricsLanguage') void state.toggleLyricsLanguage();
        if (e.data.action === 'seek' && typeof e.data.positionSec === 'number') {
          state.seekTo(e.data.positionSec);
        }
        if (e.data.action === 'shuffle') void state.toggleShuffle();
        if (e.data.action === 'repeat') void state.cycleRepeatMode();
        if (e.data.action === 'volume' && typeof e.data.volume === 'number') {
          state.updateSettings({ volume: e.data.volume });
        }
        if (e.data.action === 'like' && state.currentTrack) {
          void state.toggleLike(state.currentTrack.id, state.currentTrack);
        }
        if (e.data.action === 'lyrics') {
          void state.closeMiniPlayer(false);
          state.toggleRightPanel('lyrics');
        }
        if (e.data.action === 'open-cinema') {
          state.closeMiniPlayer(true);
        }
      }
    };
    return () => ch.close();
  }, []);

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
    if (isResettingRef.current) return;
    isResettingRef.current = true;
    accountMutationVersionRef.current += 1;
    accountEpochRef.current += 1;
    librarySyncRequestIdRef.current += 1;
    queueNextRequestIdRef.current += 1;

    try {
      // Credentials are reset first. If browser-session cleanup fails, local
      // data is left untouched so the user can retry safely.
      const authResult = await ytmClient.resetYtmAuth();
      if (!authResult.ok) {
        throw new Error(authResult.error || 'Could not sign out of YouTube Music.');
      }

      await waitForPendingLibraryWrites();
      try {
        await clearAllLocalDatabase();
      } catch (err) {
        throw new Error(
          `YouTube Music was signed out, but local data could not be cleared completely: ${
            err instanceof Error ? err.message : 'IndexedDB reset failed.'
          }`,
        );
      }
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignore
      }
      pendingPersistedLibraryRef.current = null;
      pendingPersistedQueueRef.current = null;
      ytAuthStatusRef.current = null;
      setYtAuthStatus(null);
      setYtAuthVerified(false);
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
      queueRef.current = [];
      queueIndexRef.current = 0;
      currentTrackRef.current = null;
      setQueue([]);
      setQueueIndex(0);
      setCurrentTrack(null);
      audioEngine.pause();
      setIsPlaying(false);
      setPositionSec(0);
      setDurationSec(0);
      setSpotifyConnection(null);
      commitLikedTrackSets([], []);
      window.location.reload();
    } catch (err) {
      isResettingRef.current = false;
      throw err;
    }
  }, [commitLikedTrackSets]);

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
    ytAccountMutationPending,
    ytLoginError,
    ytLoginRetryable,
    ytLoginBlocked,
    clearYtLoginError,
    retryYtMusicSignIn,
    resetYtVault,
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
    toggleLyricsLanguage,

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
    effectiveThemeColor,

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
