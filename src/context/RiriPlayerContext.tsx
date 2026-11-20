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
  NavigationView,
  PlayEvent,
  Playlist,
  PlaylistTag,
  RepeatMode,
  ScreenRoute,
  SponsorBlockSegment,
  SpotifyConnection,
  SpotifySyncSchedule,
  Track,
  YtMusicAccount,
  YtMusicBrowseItem,
  YtMusicChip,
  YtMusicHomeSection,
  YtMusicNextResult,
} from '../types/music';
import {
  DATA_SERVER_URL,
  DEFAULT_EQ_PROFILES,
  DEFAULT_PLAYLISTS,
  DEFAULT_SETTINGS,
  DEFAULT_TAGS,
  FALLBACK_ARTWORK_DATA_URL,
  HOME_CHIPS,
} from '../data/catalog';
import { applyMaterialTheme, extractPaletteFromArtwork } from '../utils/themeEngine';
import { audioEngine } from '../utils/audioEngine';
import {
  loadLibraryStateFromDb,
  saveLibraryStateToDb,
  saveLocalAudioBlob,
} from '../utils/storageDb';
import { runArchPluginSearch, resolveArchPluginStream } from '../utils/archPluginRunner';
import { parseLrcLyrics } from '../utils/lyricsParser';
import {
  getCachedGoogleAccessToken,
  initGoogleAuth,
  setDesktopGoogleAccessToken,
  signInWithGooglePopup,
  signOutGoogleFirebase,
} from '../utils/googleAuth';
import {
  appendUniqueQueueSuggestions,
  replaceUpcomingQueueWithRadio,
} from '../utils/queueHelpers';
import { isSpotifyAutoSyncDue } from '../utils/spotifySyncHelpers';

const SETTINGS_KEY = 'ririp_c_settings_v2';
const EQ_STORAGE_KEY = 'ririp_c_eq_v2';
const MINI_OVERLAY_CHANNEL = 'riri_mini_overlay';

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

interface RiriElectronAPI {
  setMinimizeToTray?: (enabled: boolean) => void;
  setFullscreen?: (fullscreen: boolean) => void;
  onFullscreenState?: (cb: (state: boolean) => void) => () => void;
  toggleOverlayWindow?: () => void;
  closeOverlayWindow?: () => void;
  onOverlayState?: (cb: (active: boolean) => void) => () => void;
  onRestoreCinema?: (cb: () => void) => () => void;
  onMediaAction?: (cb: (action: string) => void) => () => void;
  openYtMusicSignIn?: () => Promise<{
    ok: boolean;
    cookie?: string;
    visitorData?: string;
    dataSyncId?: string;
    accountName?: string;
    accountHandle?: string;
    avatarUrl?: string;
    error?: string;
  }>;
  clearYtMusicSession?: () => Promise<{ ok: boolean }>;
  openSpotifySignIn?: () => Promise<{
    ok: boolean;
    session?: {
      accessToken?: string;
      userId?: string;
      displayName?: string;
      email?: string;
      avatarUrl?: string;
      expiresAt?: number;
    };
    accessToken?: string;
    userId?: string;
    displayName?: string;
    email?: string;
    avatarUrl?: string;
    expiresAt?: number;
    error?: string;
  }>;
  clearSpotifySession?: () => Promise<{ ok: boolean }>;
}

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

  ytAccounts: YtMusicAccount[];
  activeYtAccount: YtMusicAccount | null;
  ytSavedAlbums: YtMusicBrowseItem[];
  ytFollowedArtists: YtMusicBrowseItem[];
  ytUploadedTracks: Track[];
  signInYtMusicAccount: (
    cookie: string,
    visitorData?: string,
    poToken?: string,
    fallbackName?: string,
    authUserIndex?: string,
    dataSyncId?: string,
    accountHandle?: string,
    avatarUrl?: string,
  ) => Promise<{ ok: boolean; message: string }>;
  signInWithGoogleAccount: () => Promise<{ ok: boolean; message: string }>;
  switchYtAccount: (accountId: string | null) => void;
  removeYtAccount: (accountId: string) => void;
  syncYtMusicLibrary: () => Promise<{ ok: boolean; message: string }>;
  updateYtAccountCookie: (accountId: string, cookie: string, visitorData?: string) => Promise<void>;

  // Automatic Spotify Library & Liked Songs Sync (Settings)
  spotifyConnection: SpotifyConnection | null;
  spotifySyncing: boolean;
  connectSpotifyAccount: () => Promise<{
    ok: boolean;
    message: string;
  }>;
  disconnectSpotifyAccount: () => void;
  syncSpotifyLibrary: (silent?: boolean) => Promise<{ ok: boolean; message: string }>;
  updateSpotifySchedule: (schedule: SpotifySyncSchedule) => void;

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

  // Limitless YouTube Music Queue suggestions
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
  showGoogleSignInModal: boolean;
  setShowGoogleSignInModal: (open: boolean) => void;
  signingInGoogle: boolean;
  triggerGoogleSignIn: () => Promise<void>;
  signOutGoogleAccount: () => Promise<void>;
  contextMenu: ContextMenuState | null;
  setContextMenu: (menu: ContextMenuState | null) => void;
  toast: ToastState | null;
  showToast: (message: string, type?: 'info' | 'error') => void;

  globalSearchQuery: string;
  setGlobalSearchQuery: (q: string) => void;
  searchOnlineTracks: (query: string) => Promise<Track[]>;
  searchYtMusicTracks: (query: string, filter?: string) => Promise<Track[]>;
  fetchSearchSuggestions: (query: string) => Promise<string[]>;

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
  importSpotifyPlaylist: (input: string) => Promise<{ ok: boolean; message: string; playlistId?: string }>;
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
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>(DEFAULT_PLAYLISTS);
  const [tags, setTags] = useState<PlaylistTag[]>(DEFAULT_TAGS);
  const [playEvents, setPlayEvents] = useState<PlayEvent[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<ArchPlugin[]>([]);
  const [ytAccounts, setYtAccounts] = useState<YtMusicAccount[]>([]);
  const [activeYtAccountId, setActiveYtAccountId] = useState<string | null>(null);
  const [ytSavedAlbums, setYtSavedAlbums] = useState<YtMusicBrowseItem[]>([]);
  const [ytFollowedArtists, setYtFollowedArtists] = useState<YtMusicBrowseItem[]>([]);
  const [ytUploadedTracks, setYtUploadedTracks] = useState<Track[]>([]);
  const [spotifyConnection, setSpotifyConnection] = useState<SpotifyConnection | null>(null);
  const [spotifySyncing, setSpotifySyncing] = useState(false);

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
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    queueIndexRef.current = queueIndex;
  }, [queueIndex]);

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
  const [showGoogleSignInModal, setShowGoogleSignInModal] = useState(false);
  const [signingInGoogle, setSigningInGoogle] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');

  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('LIBRARY');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  const [dynamicArtworkPrimary, setDynamicArtworkPrimary] = useState<string | null>(null);
  const [dynamicArtworkSecondary, setDynamicArtworkSecondary] = useState<string>('#1c1317');
  const [activeTrackLyrics, setActiveTrackLyrics] = useState<{
    syncedLyrics: string | null;
    plainLyrics: string | null;
    translations: string[];
    source: string | null;
    loading: boolean;
  }>({ syncedLyrics: null, plainLyrics: null, translations: [], source: null, loading: false });

  const activeYtAccount = useMemo(
    () => ytAccounts.find((a) => a.id === activeYtAccountId) || null,
    [ytAccounts, activeYtAccountId],
  );

  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    const id = Date.now();
    setToast({ id, message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 4200);
  }, []);

  // Track browser / Electron true fullscreen (F11 or Expand button)
  useEffect(() => {
    const onFsChange = () => {
      setIsAppFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    const api = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;
    const unsubFs = api?.onFullscreenState?.((fs) => setIsAppFullscreen(Boolean(fs)));
    const unsubCinema = api?.onRestoreCinema?.(() => {
      setShowMiniOverlay(false);
      setFullscreenPlayer(true);
    });
    const unsubOverlay = api?.onOverlayState?.((active) => {
      setShowMiniOverlay(Boolean(active));
    });
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      unsubFs?.();
      unsubCinema?.();
      unsubOverlay?.();
    };
  }, []);

  const toggleAppFullscreen = useCallback(() => {
    const api = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;
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
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleAppFullscreen]);

  const openMiniPlayer = useCallback(() => {
    const api = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;
    setFullscreenPlayer(false);
    if (api?.toggleOverlayWindow) {
      api.toggleOverlayWindow();
    } else {
      setShowMiniOverlay(true);
    }
  }, []);

  const closeMiniPlayer = useCallback((openCinema = false) => {
    const api = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;
    if (api?.closeOverlayWindow) {
      api.closeOverlayWindow();
    }
    setShowMiniOverlay(false);
    if (openCinema) {
      setFullscreenPlayer(true);
    }
  }, []);

  // Hydrate persistent library state from IndexedDB
  useEffect(() => {
    let cancelled = false;
    loadLibraryStateFromDb()
      .then((persisted) => {
        if (cancelled) return;
        if (persisted) {
          setTracks(persisted.tracks || []);
          setPlaylists(persisted.playlists?.length ? persisted.playlists : DEFAULT_PLAYLISTS);
          setTags(persisted.tags?.length ? persisted.tags : DEFAULT_TAGS);
          setPlayEvents(persisted.playEvents || []);
          setSearchHistory(persisted.searchHistory || []);
          setPlugins(persisted.plugins || []);
          setYtAccounts(persisted.ytAccounts || []);
          setActiveYtAccountId(persisted.activeYtAccountId ?? null);
          setYtSavedAlbums(persisted.ytSavedAlbums || []);
          setYtFollowedArtists(persisted.ytFollowedArtists || []);
          setYtUploadedTracks(persisted.ytUploadedTracks || []);
          setSpotifyConnection(persisted.spotifyConnection ?? null);
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

  // Persist library state to IndexedDB whenever modified post-hydration
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
        ytAccounts,
        activeYtAccountId,
        ytSavedAlbums,
        ytFollowedArtists,
        ytUploadedTracks,
        spotifyConnection,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    dbHydrated,
    tracks,
    playlists,
    tags,
    playEvents,
    searchHistory,
    plugins,
    ytAccounts,
    activeYtAccountId,
    ytSavedAlbums,
    ytFollowedArtists,
    ytUploadedTracks,
    spotifyConnection,
  ]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(eqState));
  }, [eqState]);

  // Keep Firebase Google Auth state synchronized cleanly
  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (firebaseUser) => {
        setYtAccounts((prev) => {
          const existing = prev.find((a) => a.id === `google-${firebaseUser.uid}`);
          if (existing) {
            return prev.map((a) =>
              a.id === `google-${firebaseUser.uid}`
                ? {
                    ...a,
                    name: firebaseUser.displayName || a.name,
                    handle: firebaseUser.email || a.handle,
                    email: firebaseUser.email || a.email,
                    avatarUrl: firebaseUser.photoURL || a.avatarUrl,
                  }
                : a,
            );
          }
          return prev;
        });
      },
      () => {
        setActiveYtAccountId((curr) => (curr?.startsWith('google-') ? null : curr));
      },
    );
    return unsubscribe;
  }, []);

  // Silent non-blocking DataServer ping
  useEffect(() => {
    void fetch('/api/remote-data')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    void DATA_SERVER_URL;
  }, []);

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

  const getYtHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {
      'x-ytm-gl': settings.contentRegion || 'US',
      'x-ytm-hl': settings.contentLanguage || 'en',
    };
    if (activeYtAccount?.cookie) h['x-ytm-cookie'] = activeYtAccount.cookie;
    const visitor = activeYtAccount?.visitorData || settings.ytMusicVisitorData;
    if (visitor) h['x-ytm-visitor'] = visitor;
    const poToken = activeYtAccount?.poToken || settings.ytMusicPoToken;
    if (poToken) h['x-ytm-potoken'] = poToken;
    if (activeYtAccount?.authUserIndex) h['x-ytm-authuser'] = activeYtAccount.authUserIndex;
    if (activeYtAccount?.dataSyncId) h['x-ytm-datasync'] = activeYtAccount.dataSyncId;
    return h;
  }, [
    activeYtAccount,
    settings.contentLanguage,
    settings.contentRegion,
    settings.ytMusicPoToken,
    settings.ytMusicVisitorData,
  ]);

  // Fetch real InnerTube FEmusic_home shelves & chips
  useEffect(() => {
    let cancelled = false;
    setHomeLoading(true);
    if (!settings.ytMusicEnabled) {
      const chip = HOME_CHIPS.find((c) => c.id === homeChip) || HOME_CHIPS[0];
      fetch(
        `/api/search?q=${encodeURIComponent(chip.query)}&limit=12&ytm=0&gl=${encodeURIComponent(
          settings.contentRegion,
        )}&hl=${encodeURIComponent(settings.contentLanguage)}`,
        { headers: getYtHeaders() },
      )
        .then((res) => (res.ok ? res.json() : { tracks: [] }))
        .then((data: { tracks?: Track[] }) => {
          if (!cancelled) {
            setHomeTracks(data.tracks || []);
            setHomeSections([]);
            setHomeChips([]);
            setHomeSourceLabel('Audius & iTunes Discovery');
            setHomeLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setHomeTracks([]);
            setHomeLoading(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    const qs = new URLSearchParams({
      gl: settings.contentRegion || 'US',
      hl: settings.contentLanguage || 'en',
    });
    if (selectedHomeChipParams) {
      qs.set('params', selectedHomeChipParams);
    }

    fetch(`/api/ytmusic/home?${qs.toString()}`, { headers: getYtHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            sections?: YtMusicHomeSection[];
            chips?: YtMusicChip[];
            tracks?: Track[];
            source?: string;
          } | null,
        ) => {
          if (cancelled) return;
          if (data) {
            setHomeSections(data.sections || []);
            if (!selectedHomeChipParams && data.chips && data.chips.length > 0) {
              setHomeChips(data.chips);
            }
            setHomeTracks(data.tracks || []);
            setHomeSourceLabel(data.source || 'YouTube Music');
          } else {
            setHomeSections([]);
            setHomeTracks([]);
          }
          setHomeLoading(false);
        },
      )
      .catch(() => {
        if (!cancelled) {
          setHomeSections([]);
          setHomeTracks([]);
          setHomeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeYtAccount,
    getYtHeaders,
    homeChip,
    selectedHomeChipParams,
    settings.contentLanguage,
    settings.contentRegion,
    settings.ytMusicEnabled,
  ]);

  const openYtMusicBrowse = useCallback(
    async (browseId: string, titleHint = 'YouTube Music Collection', params?: string) => {
      const cleanId = browseId.trim();
      if (!cleanId) return;
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
        const qs = new URLSearchParams({
          browseId: cleanId,
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        });
        if (params) qs.set('params', params);
        const res = await fetch(`/api/ytmusic/browse?${qs.toString()}`, { headers: getYtHeaders() });
        if (!res.ok) throw new Error('Browse failed');
        const data = (await res.json()) as {
          title?: string;
          subtitle?: string;
          tracks?: Track[];
          cards?: YtMusicBrowseItem[];
        };
        setBrowsedCollections((prev) => ({
          ...prev,
          [cleanId]: {
            title: data.title || titleHint,
            subtitle: data.subtitle || `${(data.tracks || []).length} track(s)`,
            tracks: data.tracks || [],
            cards: data.cards || [],
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
    [getYtHeaders, navigate, settings.contentLanguage, settings.contentRegion],
  );

  const loadCharts = useCallback(async () => {
    setChartsLoading(true);
    try {
      const res = await fetch(
        `/api/charts?gl=${encodeURIComponent(settings.contentRegion || 'US')}&hl=${encodeURIComponent(
          settings.contentLanguage || 'en',
        )}`,
        { headers: getYtHeaders() },
      );
      if (res.ok) {
        const data = (await res.json()) as { tracks?: Track[] };
        setChartsTracks(data.tracks || []);
      }
    } catch {
      // silent
    } finally {
      setChartsLoading(false);
    }
  }, [getYtHeaders, settings.contentLanguage, settings.contentRegion]);

  useEffect(() => {
    void loadCharts();
  }, [loadCharts]);

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

  // Fetch synced karaoke lyrics + optional translation
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
          const qs = new URLSearchParams({
            title: track.title,
            artist: track.artist,
            album: track.album || '',
            duration: String(Math.round(track.durationSec || 0)),
          });
          const res = await fetch(`/api/lyrics?${qs.toString()}`);
          if (res.ok) {
            const data = (await res.json()) as {
              syncedLyrics?: string | null;
              plainLyrics?: string | null;
              source?: string | null;
            };
            synced = data.syncedLyrics || null;
            plain = data.plainLyrics || null;
            source = data.source || null;
          }
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
            const trRes = await fetch('/api/translate-lyrics', {
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
    [settings.showSyncedLyricsTranslation, settings.translationLanguage],
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
        void fetch('/api/scrobble', {
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
  const resolvingPlaybackRef = useRef(false);
  const playRequestIdRef = useRef(0);
  const prefetchedStreamUrlsRef = useRef<Set<string>>(new Set());

  // Limitless YouTube Music "Up Next" queue suggestions (Radio + Chips + Continuations)
  const fetchQueueNext = useCallback(
    async (
      videoId?: string,
      playlistId?: string,
      params?: string,
      followAutomixPreview = true,
      options?: { replaceUpcoming?: boolean; title?: string; artist?: string },
    ): Promise<Track[]> => {
      if (!videoId && !playlistId && !options?.title) return [];

      setQueueNextLoading(true);
      try {
        const queryParams = new URLSearchParams();
        if (videoId) queryParams.set('videoId', videoId);
        if (playlistId) queryParams.set('playlistId', playlistId);
        if (params) queryParams.set('params', params);
        if (options?.title) queryParams.set('title', options.title);
        if (options?.artist) queryParams.set('artist', options.artist);
        queryParams.set('followAutomixPreview', String(followAutomixPreview));

        const response = await fetch(`/api/ytmusic/next?${queryParams.toString()}`, {
          headers: getYtHeaders(),
        });
        if (!response.ok) return [];

        const data = (await response.json()) as YtMusicNextResult;
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
    [getYtHeaders],
  );

  useEffect(() => {
    fetchQueueNextRef.current = fetchQueueNext;
  }, [fetchQueueNext]);

  const loadMoreQueueNext = useCallback(async (): Promise<Track[]> => {
    if (queueNextLoading) return [];
    const currentCont = queueNextResult?.continuation;

    // If continuation token exists, fetch the next infinite radio page;
    // otherwise seed fresh radio from the last track in the queue so suggestions never run out.
    if (!currentCont) {
      const seed = queueRef.current[queueRef.current.length - 1] || currentTrack;
      if (!seed) return [];
      return await fetchQueueNext(
        seed.ytMusicVideoId,
        undefined,
        undefined,
        true,
        { title: seed.title, artist: seed.artist },
      );
    }

    setQueueNextLoading(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('continuation', currentCont);
      const response = await fetch(`/api/ytmusic/next?${queryParams.toString()}`, {
        headers: getYtHeaders(),
      });
      if (!response.ok) return [];

      const data = (await response.json()) as YtMusicNextResult;
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
  }, [currentTrack, fetchQueueNext, getYtHeaders, queueNextLoading, queueNextResult]);

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
      const reqId = ++playRequestIdRef.current;

      // ArchiveTune v16.0.0 instant track switching: silence any active/loading audio immediately
      audioEngine.stopImmediate();
      setIsPlaying(false);

      let resolvedTrack = track;
      if (track.source === 'plugin' && !track.streamUrl && track.pluginId) {
        const plugin = plugins.find((p) => p.id === track.pluginId);
        if (plugin) {
          try {
            const url = await resolveArchPluginStream(plugin, track.id);
            if (reqId !== playRequestIdRef.current) return;
            if (url) {
              resolvedTrack = { ...track, streamUrl: url };
            }
          } catch (err) {
            if (reqId !== playRequestIdRef.current) return;
            showToast(err instanceof Error ? err.message : 'Plugin stream lookup failed', 'error');
          }
        }
      }

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
        void fetch(`/api/sponsorblock?videoId=${encodeURIComponent(vid)}`)
          .then((r) => (r.ok ? r.json() : { segments: [] }))
          .then((d: { segments?: SponsorBlockSegment[] }) => {
            if (reqId === playRequestIdRef.current) {
              sponsorSegmentsRef.current = d.segments || [];
            }
          })
          .catch(() => {
            if (reqId === playRequestIdRef.current) {
              sponsorSegmentsRef.current = [];
            }
          });
      }

      let resolvedQueueSnapshot: Track[] = queueRef.current;
      let activeQueueLen = queueRef.current.length;
      let activeIdx = queueIndexRef.current;
      if (newQueue && newQueue.length > 0) {
        const mappedQueue = newQueue.map((item) =>
          item.id === resolvedTrack.id ? resolvedTrack : item,
        );
        resolvedQueueSnapshot = mappedQueue;
        setQueue(mappedQueue);
        const foundIdx = mappedQueue.findIndex((t) => t.id === resolvedTrack.id);
        activeIdx = foundIdx >= 0 ? foundIdx : 0;
        activeQueueLen = mappedQueue.length;
        setQueueIndex(activeIdx);
      } else {
        const prev = queueRef.current;
        const existingIdx = prev.findIndex((t) => t.id === resolvedTrack.id);
        if (existingIdx >= 0) {
          const copy = [...prev];
          copy[existingIdx] = resolvedTrack;
          resolvedQueueSnapshot = copy;
          setQueue(copy);
          activeIdx = existingIdx;
          activeQueueLen = copy.length;
          setQueueIndex(existingIdx);
        } else {
          const nextQ = [...prev, resolvedTrack];
          resolvedQueueSnapshot = nextQ;
          setQueue(nextQ);
          activeIdx = nextQ.length - 1;
          activeQueueLen = nextQ.length;
          setQueueIndex(activeIdx);
        }
      }

      ensureTrackInStore(resolvedTrack);
      setCurrentTrack(resolvedTrack);
      setPositionSec(0);
      setDurationSec(resolvedTrack.durationSec || 30);

      resolvingPlaybackRef.current = true;
      let started = false;
      try {
        if (resolvedTrack.streamUrl.startsWith('/api/ytmusic/stream')) {
          const infoParams = new URLSearchParams();
          if (resolvedTrack.ytMusicVideoId) {
            infoParams.set('videoId', resolvedTrack.ytMusicVideoId);
          }
          if (resolvedTrack.title) infoParams.set('title', resolvedTrack.title);
          if (resolvedTrack.artist) infoParams.set('artist', resolvedTrack.artist);
          if (resolvedTrack.durationSec > 0) {
            infoParams.set('durationSec', String(resolvedTrack.durationSec));
          }
          infoParams.set('quality', settings.preferredAudioQuality || 'HIGH');
          infoParams.set('gl', settings.contentRegion || 'US');
          infoParams.set('hl', settings.contentLanguage || 'en');

          let info: {
            ok?: boolean;
            mode?: 'direct' | 'youtube_embed';
            streamUrl?: string;
            videoId?: string;
            alternateVideoIds?: string[];
          } | null = null;
          try {
            const infoRes = await fetch(`/api/ytmusic/stream-info?${infoParams.toString()}`, {
              headers: getYtHeaders(),
            });
            if (reqId !== playRequestIdRef.current) return;
            if (infoRes.ok) {
              info = await infoRes.json();
            }
          } catch {
            if (reqId !== playRequestIdRef.current) return;
            info = null;
          }

          if (reqId !== playRequestIdRef.current) return;

          if (info?.mode === 'direct' && info.streamUrl) {
            started = await audioEngine.loadAndPlay(info.streamUrl);
            if (reqId !== playRequestIdRef.current) return;
            if (!started && resolvedTrack.ytMusicVideoId) {
              started = await audioEngine.loadAndPlayYoutubeEmbed(
                resolvedTrack.ytMusicVideoId,
                info.alternateVideoIds || [],
              );
            }
          } else if (info?.mode === 'youtube_embed' && info.videoId) {
            started = await audioEngine.loadAndPlayYoutubeEmbed(
              info.videoId,
              info.alternateVideoIds || [],
            );
          } else if (resolvedTrack.ytMusicVideoId) {
            started = await audioEngine.loadAndPlayYoutubeEmbed(resolvedTrack.ytMusicVideoId);
          } else {
            started = await audioEngine.loadAndPlay(resolvedTrack.streamUrl);
          }
        } else {
          started = await audioEngine.loadAndPlay(resolvedTrack.streamUrl);
          if (reqId !== playRequestIdRef.current) return;
          if (!started && resolvedTrack.ytMusicVideoId) {
            started = await audioEngine.loadAndPlayYoutubeEmbed(resolvedTrack.ytMusicVideoId);
          }
        }
      } finally {
        if (reqId === playRequestIdRef.current) {
          resolvingPlaybackRef.current = false;
        }
      }

      if (reqId !== playRequestIdRef.current) return;

      setIsPlaying(started);
      if (started) {
        logPlayEvent(resolvedTrack);

        // Pre-warm the next queued track's stream metadata in the background for instant skipping
        const nextQueued = resolvedQueueSnapshot[activeIdx + 1];
        if (
          nextQueued &&
          nextQueued.streamUrl.startsWith('/api/ytmusic/stream') &&
          !prefetchedStreamUrlsRef.current.has(nextQueued.id)
        ) {
          if (prefetchedStreamUrlsRef.current.size > 100) {
            prefetchedStreamUrlsRef.current.clear();
          }
          prefetchedStreamUrlsRef.current.add(nextQueued.id);
          const nextParams = new URLSearchParams();
          if (nextQueued.ytMusicVideoId) nextParams.set('videoId', nextQueued.ytMusicVideoId);
          if (nextQueued.title) nextParams.set('title', nextQueued.title);
          if (nextQueued.artist) nextParams.set('artist', nextQueued.artist);
          if (nextQueued.durationSec > 0) {
            nextParams.set('durationSec', String(nextQueued.durationSec));
          }
          nextParams.set('quality', settings.preferredAudioQuality || 'HIGH');
          nextParams.set('gl', settings.contentRegion || 'US');
          nextParams.set('hl', settings.contentLanguage || 'en');
          void fetch(`/api/ytmusic/stream-info?${nextParams.toString()}`, {
            headers: getYtHeaders(),
          }).catch(() => undefined);
        }

        // Fetch limitless YT Music "Up Next" suggestions when starting a single track or nearing queue end
        if (!newQueue || newQueue.length <= 1 || activeQueueLen - activeIdx <= 2) {
          void fetchQueueNextRef.current?.(
            resolvedTrack.ytMusicVideoId,
            undefined,
            undefined,
            true,
            { title: resolvedTrack.title, artist: resolvedTrack.artist },
          );
        } else if (resolvedTrack.ytMusicVideoId && !queueNextResult) {
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
          `Could not stream "${resolvedTrack.title}". Trying another source may help.`,
          'error',
        );
      }
    },
    [
      ensureTrackInStore,
      getYtHeaders,
      logPlayEvent,
      plugins,
      queueNextResult,
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
        // Limitless queue: fetch more YT Music radio suggestions automatically before stopping
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
      if (resolvingPlaybackRef.current) return;
      setIsPlaying(false);
      showToast(msg, 'error');
    };
  }, [nextTrack, settings.sponsorBlockEnabled, showToast]);

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
      if (activeYtAccount && targetVideoId) {
        void fetch('/api/ytmusic/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getYtHeaders() },
          body: JSON.stringify({ videoId: targetVideoId, liked: !currentlyLiked }),
        }).catch(() => undefined);
      }
    },
    [activeYtAccount, currentTrack, ensureTrackInStore, getYtHeaders, isTrackLiked, tracks],
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
      if (activeYtAccount && targetPl?.ytBrowseId && track.ytMusicVideoId) {
        void fetch('/api/ytmusic/edit-playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getYtHeaders() },
          body: JSON.stringify({
            playlistId: targetPl.ytBrowseId,
            videoId: track.ytMusicVideoId,
          }),
        }).catch(() => undefined);
      }
      showToast(`Added "${track.title}" to playlist`);
    },
    [activeYtAccount, ensureTrackInStore, getYtHeaders, playlists, showToast],
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
          lines.push(t.streamUrl || t.title);
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

  const importSpotifyPlaylist = useCallback(
    async (input: string) => {
      try {
        const res = await fetch('/api/spotify-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
        });
        const data = (await res.json()) as {
          playlistTitle?: string;
          tracks?: Track[];
          message?: string;
          error?: string;
        };
        if (!res.ok) {
          return { ok: false, message: data.error || 'Spotify import failed' };
        }
        const imported = data.tracks || [];
        if (imported.length === 0) {
          return {
            ok: false,
            message:
              data.message ||
              'No playable tracks resolved. Paste a public Spotify playlist URL or "Artist - Track" lines.',
          };
        }
        const pl = createPlaylist(
          data.playlistTitle || 'Spotify Import',
          `Imported ${imported.length} tracks`,
          imported,
        );
        return {
          ok: true,
          message: `Imported ${imported.length} playable tracks into "${pl.name}".`,
          playlistId: pl.id,
        };
      } catch {
        return { ok: false, message: 'Network error while importing Spotify playlist.' };
      }
    },
    [createPlaylist],
  );

  const importYtMusicPlaylist = useCallback(
    async (input: string) => {
      try {
        const res = await fetch('/api/ytmusic/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input,
            cookie: activeYtAccount?.cookie || '',
            visitorData: activeYtAccount?.visitorData || settings.ytMusicVisitorData || '',
          }),
        });
        const data = (await res.json()) as {
          playlistTitle?: string;
          tracks?: Track[];
          message?: string;
          error?: string;
        };
        if (!res.ok) {
          return { ok: false, message: data.error || 'YouTube Music import failed' };
        }
        const imported = data.tracks || [];
        if (imported.length === 0) {
          return {
            ok: false,
            message:
              data.message ||
              'No tracks returned for this YouTube Music playlist. Check URL or sign in if private.',
          };
        }
        const pl = createPlaylist(
          data.playlistTitle || 'YouTube Music Playlist',
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
    [activeYtAccount, createPlaylist, settings.ytMusicVisitorData],
  );

  // Automatic Spotify Account OAuth + Library & Liked Songs Sync (Settings)
  const syncSpotifyLibraryWithConnection = useCallback(
    async (conn: SpotifyConnection, silent = false): Promise<{ ok: boolean; message: string }> => {
      if (spotifySyncing) return { ok: false, message: 'Spotify sync is already in progress.' };
      setSpotifySyncing(true);
      try {
        let accessToken = conn.accessToken;
        let refreshToken = conn.refreshToken;
        let expiresAt = conn.expiresAt;

        if (
          conn.authMode !== 'public_profile' &&
          conn.authMode !== 'desktop_web' &&
          (!accessToken || Date.now() >= expiresAt - 60_000) &&
          refreshToken
        ) {
          const refRes = await fetch('/api/spotify/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          if (refRes.ok) {
            const refData = (await refRes.json()) as {
              accessToken: string;
              refreshToken?: string;
              expiresAt: number;
            };
            accessToken = refData.accessToken;
            refreshToken = refData.refreshToken || refreshToken;
            expiresAt = refData.expiresAt;
            setSpotifyConnection((prev) =>
              prev ? { ...prev, accessToken, refreshToken, expiresAt } : prev,
            );
          }
        }

        const res = await fetch('/api/spotify/sync-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getYtHeaders() },
          body: JSON.stringify({
            accessToken,
            authMode: conn.authMode,
            profileUrl: conn.profileUrl || conn.userId,
            userId: conn.userId,
          }),
        });
        const data = (await res.json()) as {
          syncedAt?: number;
          likedTracks?: Track[];
          playlists?: Array<{
            spotifyId: string;
            title: string;
            description: string;
            coverUrl?: string;
            tracks: Track[];
          }>;
          error?: string;
        };

        if (!res.ok) {
          const errMsg =
            res.status === 401 && conn.authMode === 'desktop_web'
              ? 'Spotify desktop session expired. Click Disconnect and sign in again.'
              : data.error || 'Spotify library sync failed.';
          setSpotifyConnection((prev) => (prev ? { ...prev, lastError: errMsg } : prev));
          if (!silent) showToast(errMsg, 'error');
          return { ok: false, message: errMsg };
        }

        const liked = (data.likedTracks || []).map((t) => ({ ...t, liked: true }));
        const syncedPlaylists = data.playlists || [];
        const allIncomingTracks: Track[] = [...liked];
        for (const spPl of syncedPlaylists) {
          if (spPl.tracks?.length) allIncomingTracks.push(...spPl.tracks);
        }

        if (allIncomingTracks.length > 0) {
          setTracks((prev) => {
            const map = new Map(prev.map((t) => [t.id, t]));
            for (const t of allIncomingTracks) {
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
              description: 'Your favorite tracks saved locally in Riri Player',
              trackIds: liked.map((t) => t.id),
              tagIds: [],
              coverUrl: liked[0]?.thumbnailUrl,
              createdAt: Date.now(),
              isSystem: true,
            });
          }

          for (const spPl of syncedPlaylists) {
            const plId = `sp-${spPl.spotifyId}`;
            const trackIds = (spPl.tracks || []).map((t) => t.id);
            const existing = next.find((p) => p.id === plId);
            if (existing) {
              next = next.map((p) =>
                p.id === plId
                  ? {
                      ...p,
                      name: spPl.title,
                      description: spPl.description || p.description,
                      coverUrl: spPl.coverUrl || p.coverUrl,
                      trackIds: trackIds.length > 0 ? trackIds : p.trackIds,
                    }
                  : p,
              );
            } else {
              next = [
                ...next,
                {
                  id: plId,
                  name: spPl.title,
                  description: spPl.description || 'Synced from Spotify',
                  trackIds,
                  tagIds: [],
                  coverUrl: spPl.coverUrl || spPl.tracks?.[0]?.thumbnailUrl,
                  createdAt: Date.now(),
                },
              ];
            }
          }
          return next;
        });

        const totalImported =
          liked.length + syncedPlaylists.reduce((acc, p) => acc + (p.tracks?.length || 0), 0);
        const now = data.syncedAt || Date.now();
        setSpotifyConnection((prev) =>
          prev
            ? {
                ...prev,
                accessToken,
                refreshToken,
                expiresAt,
                lastSyncedAt: now,
                lastSyncedCount: totalImported,
                lastError: undefined,
              }
            : prev,
        );

        const summary =
          conn.authMode === 'public_profile'
            ? `Synced ${syncedPlaylists.length} Spotify playlist(s) (${totalImported} tracks)`
            : `Synced ${liked.length} Spotify liked songs & ${syncedPlaylists.length} playlists`;
        if (!silent) showToast(summary);
        return { ok: true, message: summary };
      } catch {
        const errMsg = 'Network error while syncing Spotify library.';
        setSpotifyConnection((prev) => (prev ? { ...prev, lastError: errMsg } : prev));
        if (!silent) showToast(errMsg, 'error');
        return { ok: false, message: errMsg };
      } finally {
        setSpotifySyncing(false);
      }
    },
    [getYtHeaders, showToast, spotifySyncing],
  );

  const syncSpotifyLibrary = useCallback(
    async (silent = false) => {
      if (!spotifyConnection) {
        return { ok: false, message: 'Sign in to Spotify first in Settings.' };
      }
      return await syncSpotifyLibraryWithConnection(spotifyConnection, silent);
    },
    [spotifyConnection, syncSpotifyLibraryWithConnection],
  );

  const connectSpotifyAccount = useCallback(async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    try {
      // 1. Desktop Electron native BrowserWindow sign-in (official accounts.spotify.com login, zero API keys)
      const electronApi = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;
      if (electronApi?.openSpotifySignIn) {
        const desktopRes = await electronApi.openSpotifySignIn();
        const sessionPayload = desktopRes?.session || desktopRes;
        if (desktopRes?.ok && sessionPayload?.accessToken) {
          const nextConn: SpotifyConnection = {
            userId: sessionPayload.userId || 'spotify-user',
            displayName: sessionPayload.displayName || 'Spotify Account',
            email: sessionPayload.email || '',
            avatarUrl: sessionPayload.avatarUrl || '',
            accessToken: sessionPayload.accessToken,
            refreshToken: '',
            expiresAt: sessionPayload.expiresAt || Date.now() + 3600_000,
            authMode: 'desktop_web',
            syncSchedule: spotifyConnection?.syncSchedule || 'MANUAL',
          };
          setSpotifyConnection(nextConn);
          showToast(`Connected Spotify account: ${nextConn.displayName}`);
          return { ok: true, message: `Connected Spotify as ${nextConn.displayName}` };
        }
        if (desktopRes?.error) {
          if (!desktopRes.error.toLowerCase().includes('closed')) {
            showToast(desktopRes.error, 'error');
          }
          return { ok: false, message: desktopRes.error };
        }
      }

      // 2. Web OAuth redirect/popup to official accounts.spotify.com/authorize
      const redirectUri = `${window.location.origin}/auth/spotify/callback`;
      const res = await fetch(`/api/spotify/auth-url?redirectUri=${encodeURIComponent(redirectUri)}`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        const msg =
          'Spotify web login requires server OAuth configuration, or use the Riri Player Desktop app for direct sign-in.';
        showToast(msg, 'error');
        return { ok: false, message: msg };
      }

      const popup = window.open(
        data.url,
        'riri_spotify_oauth',
        'width=520,height=720,menubar=no,toolbar=no,location=no,status=no',
      );
      if (!popup) {
        // Fallback: redirect directly to Spotify's official login page
        try {
          if (window.top && window.top !== window) {
            window.top.location.href = data.url;
          } else {
            window.location.assign(data.url);
          }
        } catch {
          window.location.assign(data.url);
        }
        return { ok: false, message: 'Redirecting to Spotify sign-in...' };
      }

      return await new Promise<{ ok: boolean; message: string }>((resolve) => {
        let settled = false;
        const cleanup = () => {
          window.removeEventListener('message', onMessage);
          window.clearInterval(pollTimer);
        };

        const onMessage = (ev: MessageEvent) => {
          const msg = ev.data as {
            type?: string;
            session?: Omit<SpotifyConnection, 'syncSchedule'>;
            error?: string;
          };
          if (!msg || (msg.type !== 'SPOTIFY_OAUTH_SUCCESS' && msg.type !== 'SPOTIFY_OAUTH_ERROR')) {
            return;
          }
          settled = true;
          cleanup();
          if (msg.type === 'SPOTIFY_OAUTH_SUCCESS' && msg.session) {
            const nextConn: SpotifyConnection = {
              ...msg.session,
              authMode: 'oauth',
              syncSchedule: spotifyConnection?.syncSchedule || 'MANUAL',
            };
            setSpotifyConnection(nextConn);
            showToast(`Connected Spotify account: ${nextConn.displayName}`);
            resolve({ ok: true, message: `Connected Spotify as ${nextConn.displayName}` });
          } else {
            const err = msg.error || 'Spotify authorization failed.';
            showToast(err, 'error');
            resolve({ ok: false, message: err });
          }
        };

        window.addEventListener('message', onMessage);

        const pollTimer = window.setInterval(() => {
          if (popup.closed && !settled) {
            settled = true;
            cleanup();
            resolve({ ok: false, message: 'Spotify sign-in window closed.' });
          }
        }, 500);
      });
    } catch {
      const msg = 'Could not reach Spotify login page right now.';
      showToast(msg, 'error');
      return { ok: false, message: msg };
    }
  }, [showToast, spotifyConnection?.syncSchedule]);

  // Complete full-page Spotify OAuth redirect return when popup was unavailable
  useEffect(() => {
    if (!dbHydrated) return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('route') === 'settings') {
        navigate('settings');
        params.delete('route');
        const cleaned = params.toString();
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${cleaned ? `?${cleaned}` : ''}${window.location.hash}`,
        );
      }

      const raw = localStorage.getItem('riri_pending_spotify_oauth');
      if (!raw) return;
      localStorage.removeItem('riri_pending_spotify_oauth');
      const parsed = JSON.parse(raw) as {
        type?: string;
        session?: Omit<SpotifyConnection, 'syncSchedule'>;
        error?: string;
      };
      if (parsed.type === 'SPOTIFY_OAUTH_SUCCESS' && parsed.session) {
        const nextConn: SpotifyConnection = {
          ...parsed.session,
          authMode: 'oauth',
          syncSchedule: spotifyConnection?.syncSchedule || 'MANUAL',
        };
        setSpotifyConnection(nextConn);
        showToast(`Connected Spotify account: ${nextConn.displayName}`);
      } else if (parsed.error) {
        showToast(parsed.error, 'error');
      }
    } catch {
      localStorage.removeItem('riri_pending_spotify_oauth');
    }
  }, [dbHydrated, navigate, showToast, spotifyConnection?.syncSchedule]);

  const disconnectSpotifyAccount = useCallback(() => {
    const electronApi = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;
    void electronApi?.clearSpotifySession?.();
    setSpotifyConnection(null);
    showToast('Disconnected Spotify sync account');
  }, [showToast]);

  const updateSpotifySchedule = useCallback(
    (schedule: SpotifySyncSchedule) => {
      setSpotifyConnection((prev) => (prev ? { ...prev, syncSchedule: schedule } : prev));
      showToast(
        schedule === 'MANUAL'
          ? 'Spotify auto-sync set to Manual Only'
          : `Spotify auto-sync scheduled: ${schedule.toLowerCase()}`,
      );
    },
    [showToast],
  );

  // Automatic scheduled Spotify Library sync (Every Day / Week / Year)
  useEffect(() => {
    if (!dbHydrated || !spotifyConnection) return;
    const checkDue = () => {
      if (isSpotifyAutoSyncDue(spotifyConnection.syncSchedule, spotifyConnection.lastSyncedAt)) {
        void syncSpotifyLibraryWithConnection(spotifyConnection, true);
      }
    };
    checkDue();
    const timer = window.setInterval(checkDue, 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [dbHydrated, spotifyConnection, syncSpotifyLibraryWithConnection]);

  const applySyncedYtLibraryPayload = useCallback(
    (data: {
      likedTracks?: Track[];
      playlists?: Array<{
        browseId: string;
        title: string;
        subtitle?: string;
        thumbnailUrl?: string;
        tracks?: Track[];
      }>;
      savedAlbums?: YtMusicBrowseItem[];
      followedArtists?: YtMusicBrowseItem[];
      uploadedTracks?: Track[];
    }) => {
      const liked = (data.likedTracks || []).map((t) => ({ ...t, liked: true }));
      const uploads = data.uploadedTracks || [];
      const cloudPls = data.playlists || [];

      const allToStore: Track[] = [...liked, ...uploads];
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
              },
            ];
          }
        }
        return next;
      });

      if (data.savedAlbums) setYtSavedAlbums(data.savedAlbums);
      if (data.followedArtists) setYtFollowedArtists(data.followedArtists);
      if (data.uploadedTracks) setYtUploadedTracks(data.uploadedTracks);
    },
    [],
  );

  const signInYtMusicAccount = useCallback(
    async (
      cookie: string,
      visitorData = '',
      poToken = '',
      fallbackName = '',
      authUserIndex = '0',
      dataSyncId = '',
      accountHandle = '',
      avatarUrl = '',
    ) => {
      try {
        const res = await fetch('/api/ytmusic/library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cookie,
            visitorData: visitorData || settings.ytMusicVisitorData,
            authUserIndex: authUserIndex || '0',
            dataSyncId: dataSyncId || '',
            accountName: fallbackName || '',
            accountHandle: accountHandle || '',
            avatarUrl: avatarUrl || '',
            gl: settings.contentRegion || 'US',
            hl: settings.contentLanguage || 'en',
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          account?: { name?: string; handle?: string; avatarUrl?: string };
          likedTracks?: Track[];
          playlists?: Array<{
            browseId: string;
            title: string;
            subtitle?: string;
            thumbnailUrl?: string;
            tracks?: Track[];
          }>;
          savedAlbums?: YtMusicBrowseItem[];
          followedArtists?: YtMusicBrowseItem[];
          uploadedTracks?: Track[];
        };
        if (!res.ok || !data.ok) {
          return {
            ok: false,
            message: data.error || 'Could not authenticate YouTube Music cookie.',
          };
        }

        const acct: YtMusicAccount = {
          id: `ytacct-${Date.now()}`,
          name: data.account?.name || fallbackName || 'YouTube Music User',
          handle: data.account?.handle || accountHandle || '',
          avatarUrl: data.account?.avatarUrl || avatarUrl || '',
          cookie: cookie.trim(),
          visitorData: visitorData.trim() || undefined,
          poToken: poToken.trim() || undefined,
          authUserIndex: authUserIndex.trim() || '0',
          dataSyncId: dataSyncId.trim() || undefined,
          addedAt: Date.now(),
        };

        setYtAccounts((prev) => [acct, ...prev]);
        setActiveYtAccountId(acct.id);
        applySyncedYtLibraryPayload(data);

        const likedCount = data.likedTracks?.length || 0;
        const plCount = data.playlists?.length || 0;
        showToast(`Signed in as ${acct.name} · Synced ${likedCount} liked songs & ${plCount} playlists`);
        return {
          ok: true,
          message: `Signed in as ${acct.name}. Synced ${likedCount} liked songs & ${plCount} playlists.`,
        };
      } catch {
        return { ok: false, message: 'Could not verify Google session.' };
      }
    },
    [
      applySyncedYtLibraryPayload,
      settings.contentLanguage,
      settings.contentRegion,
      settings.ytMusicVisitorData,
      showToast,
    ],
  );

  const switchYtAccount = useCallback(
    (accountId: string | null) => {
      setActiveYtAccountId(accountId);
      const acct = ytAccounts.find((a) => a.id === accountId);
      showToast(acct ? `Switched to ${acct.name}` : 'Signed out');
    },
    [showToast, ytAccounts],
  );

  const removeYtAccount = useCallback(
    (accountId: string) => {
      setYtAccounts((prev) => prev.filter((a) => a.id !== accountId));
      setActiveYtAccountId((curr) => (curr === accountId ? null : curr));
      showToast('Removed Google account');
    },
    [showToast],
  );

  const updateYtAccountCookie = useCallback(
    async (accountId: string, cookie: string, visitorData?: string) => {
      setYtAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? { ...a, cookie, visitorData, authProvider: 'ytmusic' as const }
            : a,
        ),
      );
      setActiveYtAccountId((curr) => (curr === accountId ? accountId : curr));
      showToast('YouTube Music cookie updated. Syncing library...');
      await syncYtMusicLibraryRef.current?.();
    },
    [showToast],
  );

  const completeGoogleOAuthLogin = useCallback(
    async (user: {
      uid: string;
      name: string;
      email: string;
      avatarUrl: string;
      accessToken: string;
    }): Promise<{ ok: boolean; message: string }> => {
      if (user.accessToken) {
        setDesktopGoogleAccessToken(user.accessToken);
      }

      let syncPayload: {
        account?: { name?: string; handle?: string; avatarUrl?: string };
        likedTracks?: Track[];
        playlists?: Array<{
          browseId: string;
          title: string;
          subtitle?: string;
          thumbnailUrl?: string;
          tracks?: Track[];
        }>;
        savedAlbums?: YtMusicBrowseItem[];
        followedArtists?: YtMusicBrowseItem[];
        uploadedTracks?: Track[];
        apiNotice?: string;
      } = {};

      if (user.accessToken) {
        try {
          const res = await fetch('/api/google/library', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${user.accessToken}`,
            },
            body: JSON.stringify({
              name: user.name,
              email: user.email,
              avatarUrl: user.avatarUrl,
            }),
          });
          if (res.ok) {
            syncPayload = (await res.json()) as typeof syncPayload;
          }
        } catch {
          // Keep user signed in with profile even if offline
        }
      }

      const acctId = `google-${user.uid || Date.now()}`;
      const acct: YtMusicAccount = {
        id: acctId,
        name: syncPayload.account?.name || user.name || 'Google User',
        handle: syncPayload.account?.handle || user.email || '',
        email: user.email || '',
        avatarUrl: syncPayload.account?.avatarUrl || user.avatarUrl || '',
        authProvider: 'google',
        cookie: '',
        addedAt: Date.now(),
      };

      setYtAccounts((prev) => [acct, ...prev.filter((a) => a.id !== acctId)]);
      setActiveYtAccountId(acctId);
      applySyncedYtLibraryPayload(syncPayload);

      const likedCount = syncPayload.likedTracks?.length || 0;
      const plCount = syncPayload.playlists?.length || 0;
      const summary =
        likedCount > 0 || plCount > 0
          ? `Signed in as ${acct.name} · Imported ${likedCount} liked songs & ${plCount} playlists`
          : `Signed in as ${acct.name}`;
      showToast(summary);
      return { ok: true, message: syncPayload.apiNotice || summary };
    },
    [applySyncedYtLibraryPayload, showToast],
  );

  const signInWithGoogleAccount = useCallback(async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    setSigningInGoogle(true);
    try {
      const authRes = await signInWithGooglePopup();
      return await completeGoogleOAuthLogin({
        uid: authRes.uid,
        name: authRes.displayName,
        email: authRes.email,
        avatarUrl: authRes.photoURL,
        accessToken: authRes.accessToken,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-blocked') {
        setShowGoogleSignInModal(true);
        return { ok: false, message: 'Popup was blocked. Click Sign in with Google below.' };
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return { ok: false, message: 'Google sign-in was cancelled.' };
      }
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Google sign-in failed.',
      };
    } finally {
      setSigningInGoogle(false);
    }
  }, [completeGoogleOAuthLogin]);

  const triggerGoogleSignIn = useCallback(async () => {
    const electronApi = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;

    if (electronApi?.openYtMusicSignIn) {
      setSigningInGoogle(true);
      try {
        const res = await electronApi.openYtMusicSignIn();
        if (res.ok && res.cookie) {
          const signed = await signInYtMusicAccount(
            res.cookie,
            res.visitorData || settings.ytMusicVisitorData || '',
            settings.ytMusicPoToken || '',
            res.accountName || '',
            '0',
            res.dataSyncId || '',
            res.accountHandle || '',
            res.avatarUrl || '',
          );
          if (!signed.ok) {
            showToast(signed.message, 'error');
          }
        } else if (res.error) {
          showToast(res.error, 'error');
        }
      } finally {
        setSigningInGoogle(false);
      }
      return;
    }

    const res = await signInWithGoogleAccount();
    if (!res.ok && res.message && !res.message.includes('cancelled')) {
      showToast(res.message, 'error');
    }
  }, [
    settings.ytMusicPoToken,
    settings.ytMusicVisitorData,
    showToast,
    signInWithGoogleAccount,
    signInYtMusicAccount,
  ]);

  const signOutGoogleAccount = useCallback(async () => {
    const electronApi = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;

    await signOutGoogleFirebase();
    if (electronApi?.clearYtMusicSession) {
      await electronApi.clearYtMusicSession().catch(() => undefined);
    }

    const activeId = activeYtAccountId;
    setActiveYtAccountId(null);
    if (activeId) {
      setYtAccounts((prev) => prev.filter((a) => a.id !== activeId));
    }
    setYtSavedAlbums([]);
    setYtFollowedArtists([]);
    setYtUploadedTracks([]);
    setPlaylists((prev) => prev.filter((p) => !p.ytBrowseId));
    showToast('Signed out');
  }, [activeYtAccountId, showToast]);

  const syncYtMusicLibrary = useCallback(async () => {
    if (!activeYtAccount) {
      return { ok: false, message: 'No Google account signed in.' };
    }

    if (activeYtAccount.authProvider === 'google' || !activeYtAccount.cookie) {
      try {
        let token = getCachedGoogleAccessToken();
        if (!token) {
          const refreshed = await signInWithGooglePopup();
          token = refreshed.accessToken;
        }
        if (!token) {
          return { ok: false, message: 'Sign in with Google to refresh library sync.' };
        }
        const res = await fetch('/api/google/library', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: activeYtAccount.name,
            email: activeYtAccount.email || activeYtAccount.handle || '',
            avatarUrl: activeYtAccount.avatarUrl || '',
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          likedTracks?: Track[];
          playlists?: Array<{
            browseId: string;
            title: string;
            subtitle?: string;
            thumbnailUrl?: string;
            tracks?: Track[];
          }>;
          savedAlbums?: YtMusicBrowseItem[];
          followedArtists?: YtMusicBrowseItem[];
          uploadedTracks?: Track[];
          apiNotice?: string;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          return { ok: false, message: data.error || 'Sync failed.' };
        }
        applySyncedYtLibraryPayload(data);
        const liked = data.likedTracks?.length || 0;
        const pls = data.playlists?.length || 0;
        showToast(
          data.apiNotice
            ? data.apiNotice
            : `Synced ${liked} liked songs & ${pls} playlists`,
        );
        return {
          ok: true,
          message: `Synced ${liked} liked tracks and ${pls} playlists.`,
        };
      } catch {
        return { ok: false, message: 'Google library sync cancelled or failed.' };
      }
    }

    try {
      const res = await fetch('/api/ytmusic/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookie: activeYtAccount.cookie,
          visitorData: activeYtAccount.visitorData || settings.ytMusicVisitorData,
          authUserIndex: activeYtAccount.authUserIndex || '0',
          dataSyncId: activeYtAccount.dataSyncId || '',
          gl: settings.contentRegion || 'US',
          hl: settings.contentLanguage || 'en',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        likedTracks?: Track[];
        playlists?: Array<{
          browseId: string;
          title: string;
          subtitle?: string;
          thumbnailUrl?: string;
          tracks?: Track[];
        }>;
        savedAlbums?: YtMusicBrowseItem[];
        followedArtists?: YtMusicBrowseItem[];
        uploadedTracks?: Track[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        return { ok: false, message: data.error || 'Sync failed.' };
      }
      applySyncedYtLibraryPayload(data);
      const liked = data.likedTracks?.length || 0;
      const pls = data.playlists?.length || 0;
      const albums = data.savedAlbums?.length || 0;
      showToast(`Synced ${liked} liked songs, ${pls} playlists, ${albums} albums`);
      return {
        ok: true,
        message: `Synced ${liked} liked tracks, ${pls} playlists, and ${albums} saved albums.`,
      };
    } catch {
      return { ok: false, message: 'Sync failed due to network error.' };
    }
  }, [
    activeYtAccount,
    applySyncedYtLibraryPayload,
    settings.contentLanguage,
    settings.contentRegion,
    settings.ytMusicVisitorData,
    showToast,
  ]);

  useEffect(() => {
    syncYtMusicLibraryRef.current = syncYtMusicLibrary;
  }, [syncYtMusicLibrary]);

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

  const searchYtMusicTracks = useCallback(
    async (query: string, filter = 'songs'): Promise<Track[]> => {
      const q = query.trim();
      if (!q) return [];
      try {
        const res = await fetch(
          `/api/ytmusic/search?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(
            filter,
          )}&gl=${encodeURIComponent(settings.contentRegion || 'US')}&hl=${encodeURIComponent(
            settings.contentLanguage || 'en',
          )}`,
          { headers: getYtHeaders() },
        );
        if (!res.ok) return [];
        const data = (await res.json()) as { tracks?: Track[] };
        return data.tracks || [];
      } catch {
        return [];
      }
    },
    [getYtHeaders, settings.contentLanguage, settings.contentRegion],
  );

  const fetchSearchSuggestions = useCallback(
    async (query: string): Promise<string[]> => {
      const q = query.trim();
      if (!q || !settings.ytMusicEnabled) return [];
      try {
        const res = await fetch(
          `/api/ytmusic/suggestions?q=${encodeURIComponent(q)}&gl=${encodeURIComponent(
            settings.contentRegion || 'US',
          )}&hl=${encodeURIComponent(settings.contentLanguage || 'en')}`,
          { headers: getYtHeaders() },
        );
        if (!res.ok) return [];
        const data = (await res.json()) as { suggestions?: string[] };
        return data.suggestions || [];
      } catch {
        return [];
      }
    },
    [getYtHeaders, settings.contentLanguage, settings.contentRegion, settings.ytMusicEnabled],
  );

  const searchOnlineTracks = useCallback(
    async (query: string): Promise<Track[]> => {
      const q = query.trim();
      if (!q) return [];
      const enabledPlugins = plugins.filter((p) => p.enabled);
      const ytmFlag = settings.ytMusicEnabled ? '1' : '0';

      const [apiRes, ...pluginResults] = await Promise.all([
        fetch(
          `/api/search?q=${encodeURIComponent(q)}&limit=24&ytm=${ytmFlag}&gl=${encodeURIComponent(
            settings.contentRegion || 'US',
          )}&hl=${encodeURIComponent(settings.contentLanguage || 'en')}`,
          { headers: getYtHeaders() },
        )
          .then((r) => (r.ok ? r.json() : { tracks: [] }))
          .then((d: { tracks?: Track[] }) => d.tracks || [])
          .catch(() => [] as Track[]),
        ...enabledPlugins.map((p) => runArchPluginSearch(p, q).catch(() => [] as Track[])),
      ]);

      const combined = [...apiRes, ...pluginResults.flat()];
      const seen = new Set<string>();
      return combined.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    },
    [getYtHeaders, plugins, settings.contentLanguage, settings.contentRegion, settings.ytMusicEnabled],
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
        version: '1.0',
        exportedAt: new Date().toISOString(),
        settings,
        eqState,
        tracks: persistableTracks,
        playlists,
        tags,
        playEvents,
        searchHistory,
        plugins,
        ytAccounts,
        activeYtAccountId,
        ytSavedAlbums,
        ytFollowedArtists,
        ytUploadedTracks,
      },
      null,
      2,
    );
  }, [
    activeYtAccountId,
    eqState,
    playEvents,
    playlists,
    plugins,
    searchHistory,
    settings,
    tags,
    tracks,
    ytAccounts,
    ytFollowedArtists,
    ytSavedAlbums,
    ytUploadedTracks,
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
          plugins?: ArchPlugin[];
          ytAccounts?: YtMusicAccount[];
          activeYtAccountId?: string | null;
          ytSavedAlbums?: YtMusicBrowseItem[];
          ytFollowedArtists?: YtMusicBrowseItem[];
          ytUploadedTracks?: Track[];
        };
        if (parsed.app !== 'Riri Player' && parsed.app !== 'ArchiveTunePC') {
          return { ok: false, message: 'Invalid Riri Player backup file.' };
        }
        if (parsed.settings) setSettings((s) => ({ ...s, ...parsed.settings }));
        if (parsed.eqState?.profiles?.length) setEqState(parsed.eqState);
        if (Array.isArray(parsed.tracks)) setTracks(parsed.tracks);
        if (Array.isArray(parsed.playlists)) setPlaylists(parsed.playlists);
        if (Array.isArray(parsed.tags)) setTags(parsed.tags);
        if (Array.isArray(parsed.playEvents)) setPlayEvents(parsed.playEvents);
        if (Array.isArray(parsed.searchHistory)) setSearchHistory(parsed.searchHistory);
        if (Array.isArray(parsed.plugins)) setPlugins(parsed.plugins);
        if (Array.isArray(parsed.ytAccounts)) setYtAccounts(parsed.ytAccounts);
        if (parsed.activeYtAccountId !== undefined) setActiveYtAccountId(parsed.activeYtAccountId);
        if (Array.isArray(parsed.ytSavedAlbums)) setYtSavedAlbums(parsed.ytSavedAlbums);
        if (Array.isArray(parsed.ytFollowedArtists)) setYtFollowedArtists(parsed.ytFollowedArtists);
        if (Array.isArray(parsed.ytUploadedTracks)) setYtUploadedTracks(parsed.ytUploadedTracks);
        showToast('Backup restored successfully');
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
    ch.postMessage({
      type: 'STATE',
      payload: {
        currentTrack,
        isPlaying,
        positionSec,
        durationSec,
        miniOverlayTheme: settings.miniOverlayTheme,
        sliderStyle: settings.sliderStyle,
        themeSeedColor: settings.themeColor,
        darkMode: settings.darkMode,
        themeSurfaceStyle: settings.themeSurfaceStyle,
      },
    });
    return () => ch.close();
  }, [
    currentTrack,
    durationSec,
    isPlaying,
    positionSec,
    settings.darkMode,
    settings.miniOverlayTheme,
    settings.sliderStyle,
    settings.themeColor,
    settings.themeSurfaceStyle,
  ]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(MINI_OVERLAY_CHANNEL);
    ch.onmessage = (e: MessageEvent<{ type?: string; action?: string; positionSec?: number }>) => {
      if (e.data?.type === 'REQUEST_STATE') {
        ch.postMessage({
          type: 'STATE',
          payload: {
            currentTrack,
            isPlaying,
            positionSec,
            durationSec,
            miniOverlayTheme: settings.miniOverlayTheme,
            sliderStyle: settings.sliderStyle,
            themeSeedColor: settings.themeColor,
            darkMode: settings.darkMode,
            themeSurfaceStyle: settings.themeSurfaceStyle,
          },
        });
      } else if (e.data?.type === 'CMD') {
        if (e.data.action === 'toggle') void togglePlayPause();
        if (e.data.action === 'next') void nextTrack();
        if (e.data.action === 'prev') void prevTrack();
        if (e.data.action === 'seek' && typeof e.data.positionSec === 'number') {
          seekTo(e.data.positionSec);
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
    seekTo,
    settings.darkMode,
    settings.miniOverlayTheme,
    settings.sliderStyle,
    settings.themeColor,
    settings.themeSurfaceStyle,
    togglePlayPause,
  ]);

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;
    api?.setMinimizeToTray?.(Boolean(settings.minimizeToTray));
  }, [settings.minimizeToTray]);

  // Sync Electron media control events if running inside Desktop shell
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: RiriElectronAPI }).electronAPI;
    if (!api?.onMediaAction) return;
    return api.onMediaAction((action) => {
      if (action === 'play-pause') void togglePlayPause();
      if (action === 'next') void nextTrack();
      if (action === 'prev') void prevTrack();
    });
  }, [nextTrack, prevTrack, togglePlayPause]);

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

    ytAccounts,
    activeYtAccount,
    ytSavedAlbums,
    ytFollowedArtists,
    ytUploadedTracks,
    signInYtMusicAccount,
    signInWithGoogleAccount,
    switchYtAccount,
    removeYtAccount,
    syncYtMusicLibrary,
    updateYtAccountCookie,

    spotifyConnection,
    spotifySyncing,
    connectSpotifyAccount,
    disconnectSpotifyAccount,
    syncSpotifyLibrary,
    updateSpotifySchedule,

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
    showGoogleSignInModal,
    setShowGoogleSignInModal,
    signingInGoogle,
    triggerGoogleSignIn,
    signOutGoogleAccount,
    contextMenu,
    setContextMenu,
    toast,
    showToast,

    globalSearchQuery,
    setGlobalSearchQuery,
    searchOnlineTracks,
    searchYtMusicTracks,
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

    queueNextResult,
    queueNextLoading,
    fetchQueueNext,
    loadMoreQueueNext,
    toggleQueueChip,

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
