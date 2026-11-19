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
  Track,
  YtMusicAccount,
  YtMusicBrowseItem,
  YtMusicChip,
  YtMusicHomeSection,
  YtMusicNextResult,
  YtMusicQueueChip,
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

const SETTINGS_KEY = 'ririp_c_settings_v2';
const EQ_STORAGE_KEY = 'ririp_c_eq_v2';

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

interface ArchiveTuneContextValue {
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

  // Queue suggestions / "Up Next" (YouTube Music style)
  queueNextResult: YtMusicNextResult | null;
  queueNextLoading: boolean;
  fetchQueueNext: (videoId?: string, playlistId?: string, params?: string, followAutomixPreview?: boolean) => Promise<void>;
  loadMoreQueueNext: () => Promise<void>;
  toggleQueueChip: (chipId: string) => Promise<void>;

  sleepTimerMinLeft: number | null;
  setSleepTimer: (minutes: number | null) => void;

  rightPanel: RightPanelTab;
  setRightPanel: (tab: RightPanelTab) => void;
  toggleRightPanel: (tab: 'lyrics' | 'queue') => void;
  fullscreenPlayer: boolean;
  setFullscreenPlayer: (open: boolean) => void;
  showMiniOverlay: boolean;
  setShowMiniOverlay: (open: boolean) => void;
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

const ArchiveTuneContext = createContext<ArchiveTuneContextValue | null>(null);

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

export const ArchiveTuneProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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

  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...loadLocalJson<Partial<AppSettings>>(SETTINGS_KEY, {}),
  }));

  const [eqState, setEqState] = useState<{ profiles: EqProfile[]; activeId: string }>(() =>
    loadLocalJson(EQ_STORAGE_KEY, {
      profiles: DEFAULT_EQ_PROFILES,
      activeId: 'eq-archivetune',
    }),
  );

  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('OFF');
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [queueNextResult, setQueueNextResult] = useState<YtMusicNextResult | null>(null);
  const [queueNextLoading, setQueueNextLoading] = useState(false);
  const fetchQueueNextRef = useRef<typeof fetchQueueNext>(null);
  const syncYtMusicLibraryRef = useRef<typeof syncYtMusicLibrary>(null);
  const [sleepTimerMinLeft, setSleepTimerMinLeft] = useState<number | null>(null);

  const [rightPanel, setRightPanel] = useState<RightPanelTab>('closed');
  const [fullscreenPlayer, setFullscreenPlayer] = useState(false);
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

  // Fetch real InnerTube FEmusic_home shelves & chips (respecting gl/hl & signed-in SAPISIDHASH)
  useEffect(() => {
    let cancelled = false;
    setHomeLoading(true);
    if (!settings.ytMusicEnabled) {
      const chip = HOME_CHIPS.find((c) => c.id === homeChip) || HOME_CHIPS[0];
      fetch(
        `/api/search?q=${encodeURIComponent(chip.query)}&limit=24&ytm=0&gl=${encodeURIComponent(
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
            sponsorSegmentsRef.current = d.segments || [];
          })
          .catch(() => {
            sponsorSegmentsRef.current = [];
          });
      }

      if (newQueue && newQueue.length > 0) {
        const mappedQueue = newQueue.map((item) =>
          item.id === resolvedTrack.id ? resolvedTrack : item,
        );
        setQueue(mappedQueue);
        const foundIdx = mappedQueue.findIndex((t) => t.id === resolvedTrack.id);
        setQueueIndex(foundIdx >= 0 ? foundIdx : 0);
      } else {
        setQueue((prev) => {
          const existingIdx = prev.findIndex((t) => t.id === resolvedTrack.id);
          if (existingIdx >= 0) {
            setQueueIndex(existingIdx);
            const copy = [...prev];
            copy[existingIdx] = resolvedTrack;
            return copy;
          }
          const nextQ = [...prev, resolvedTrack];
          setQueueIndex(nextQ.length - 1);
          return nextQ;
        });
      }

      ensureTrackInStore(resolvedTrack);
      setCurrentTrack(resolvedTrack);
      setPositionSec(0);
      setDurationSec(resolvedTrack.durationSec || 30);

      const started = await audioEngine.loadAndPlay(resolvedTrack.streamUrl);
      setIsPlaying(started);
      if (started) {
        logPlayEvent(resolvedTrack);
        
        // Fetch YouTube Music "Up Next" queue with suggestions for YT Music tracks
        if (resolvedTrack.source === 'ytmusic' && resolvedTrack.ytMusicVideoId) {
          void fetchQueueNextRef.current?.(resolvedTrack.ytMusicVideoId);
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
      logPlayEvent,
      plugins,
      settings.contentLanguage,
      settings.contentRegion,
      settings.preferredAudioQuality,
      settings.sponsorBlockEnabled,
      showToast,
    ],
  );

  const nextTrack = useCallback(async () => {
    if (queue.length === 0) return;
    if (repeatMode === 'ONE' && currentTrack) {
      audioEngine.seek(0);
      await audioEngine.play();
      setIsPlaying(true);
      return;
    }

    let nextIdx = queueIndex + 1;
    if (shuffleEnabled && queue.length > 1) {
      let randIdx = Math.floor(Math.random() * queue.length);
      if (randIdx === queueIndex) randIdx = (queueIndex + 1) % queue.length;
      nextIdx = randIdx;
    } else if (nextIdx >= queue.length) {
      if (repeatMode === 'ALL') {
        nextIdx = 0;
      } else {
        setIsPlaying(false);
        return;
      }
    }

    const target = queue[nextIdx];
    if (target) {
      setQueueIndex(nextIdx);
      await playTrack(target, queue);
    }
  }, [currentTrack, playTrack, queue, queueIndex, repeatMode, shuffleEnabled]);

  const prevTrack = useCallback(async () => {
    if (positionSec > 3) {
      audioEngine.seek(0);
      setPositionSec(0);
      return;
    }
    if (queue.length === 0) return;
    const prevIdx = queueIndex - 1 < 0 ? queue.length - 1 : queueIndex - 1;
    const target = queue[prevIdx];
    if (target) {
      setQueueIndex(prevIdx);
      await playTrack(target, queue);
    }
  }, [playTrack, positionSec, queue, queueIndex]);

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
        const filtered = prev.filter((t, i) => !(t.id === track.id && i !== queueIndex));
        const insertAt = Math.min(queueIndex + 1, filtered.length);
        const copy = [...filtered];
        copy.splice(insertAt, 0, track);
        return copy;
      });
      showToast(`"${track.title}" will play next`);
    },
    [ensureTrackInStore, queueIndex, showToast],
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

  // Fetch YouTube Music "Up Next" queue with suggestions (Song Radio, Artist Radio, etc.)
  const fetchQueueNext = useCallback(
    async (
      videoId?: string,
      playlistId?: string,
      params?: string,
      followAutomixPreview?: boolean,
    ) => {
      if (!videoId && !playlistId) return;
      
      setQueueNextLoading(true);
      try {
        const queryParams = new URLSearchParams();
        if (videoId) queryParams.set('videoId', videoId);
        if (playlistId) queryParams.set('playlistId', playlistId);
        if (params) queryParams.set('params', params);
        if (followAutomixPreview) queryParams.set('followAutomixPreview', 'true');
        
        // Add auth headers if we have an active YT account
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (activeYtAccount) {
          headers['Cookie'] = activeYtAccount.cookie;
          if (activeYtAccount.visitorData) headers['X-Goog-Visitor-Id'] = activeYtAccount.visitorData;
        }
        
        const response = await fetch(`/api/ytmusic/next?${queryParams.toString()}`, {
          headers,
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch queue next');
        }
        
        const data = await response.json();
        setQueueNextResult(data);
      } catch (error) {
        console.error('Failed to fetch queue next:', error);
        setQueueNextResult(null);
      } finally {
        setQueueNextLoading(false);
      }
    },
    [activeYtAccount],
  );

  // Keep ref in sync
  useEffect(() => {
    fetchQueueNextRef.current = fetchQueueNext;
  }, [fetchQueueNext]);

  // Load more items from the queue next (pagination)
  const loadMoreQueueNext = useCallback(async () => {
    if (!queueNextResult?.continuation || queueNextLoading) return;
    
    setQueueNextLoading(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('continuation', queueNextResult.continuation);
      
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeYtAccount) {
        headers['Cookie'] = activeYtAccount.cookie;
        if (activeYtAccount.visitorData) headers['X-Goog-Visitor-Id'] = activeYtAccount.visitorData;
      }
      
      const response = await fetch(`/api/ytmusic/next?${queryParams.toString()}`, {
        headers,
      });
      
      if (!response.ok) {
        throw new Error('Failed to load more queue next');
      }
      
      const data = await response.json();
      // Append new items to existing ones
      setQueueNextResult((prev) => {
        if (!prev) return data;
        return {
          ...data,
          items: [...prev.items, ...data.items],
        };
      });
    } catch (error) {
      console.error('Failed to load more queue next:', error);
    } finally {
      setQueueNextLoading(false);
    }
  }, [queueNextResult, queueNextLoading, activeYtAccount]);

  // Toggle a queue chip (e.g., Song Radio, Artist Radio)
  const toggleQueueChip = useCallback(
    async (chipId: string) => {
      const chip = queueNextResult?.queueChips.find((c) => c.id === chipId);
      if (!chip) return;
      
      // If chip has a deselect endpoint and is currently selected, use that
      // Otherwise use the regular endpoint
      const endpoint = chip.selected && chip.deselectEndpoint
        ? chip.deselectEndpoint
        : chip.endpoint;
      
      if (!endpoint?.watchEndpoint) return;
      
      const { videoId, playlistId, params } = endpoint.watchEndpoint;
      
      // Fetch the new queue based on the chip
      await fetchQueueNext(videoId, playlistId, params, false);
    },
    [queueNextResult, fetchQueueNext],
  );

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
      // Also update the active account if it's the same
      setActiveYtAccountId((curr) =>
        curr === accountId ? accountId : curr,
      );
      showToast('YouTube Music cookie updated. Syncing library...');
      // Auto-sync library after cookie update
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
    const electronApi = (window as unknown as {
      electronAPI?: {
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
      };
    }).electronAPI;

    // In the Windows Electron app, sign into Google Accounts directly so ANY user account works
    // with zero OAuth Testing/verification restrictions and full YouTube Music library sync.
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
    const electronApi = (window as unknown as {
      electronAPI?: {
        clearYtMusicSession?: () => Promise<{ ok: boolean }>;
      };
    }).electronAPI;

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

  // Keep ref in sync
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
        if (parsed.app !== 'ArchiveTunePC') {
          return { ok: false, message: 'Invalid ArchiveTune backup file.' };
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

  // Broadcast playback state for standalone Windows Electron Always-On-Top Mini-Player Overlay
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('archivetune_mini_overlay');
    ch.postMessage({
      type: 'STATE',
      payload: {
        currentTrack,
        isPlaying,
        positionSec,
        durationSec,
        miniOverlayTheme: settings.miniOverlayTheme,
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
    settings.themeColor,
    settings.themeSurfaceStyle,
  ]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('archivetune_mini_overlay');
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
      }
    };
    return () => ch.close();
  }, [
    currentTrack,
    durationSec,
    isPlaying,
    nextTrack,
    positionSec,
    prevTrack,
    seekTo,
    settings.darkMode,
    settings.miniOverlayTheme,
    settings.themeColor,
    settings.themeSurfaceStyle,
    togglePlayPause,
  ]);

  useEffect(() => {
    const api = (window as unknown as {
      electronAPI?: { setMinimizeToTray?: (enabled: boolean) => void };
    }).electronAPI;
    api?.setMinimizeToTray?.(Boolean(settings.minimizeToTray));
  }, [settings.minimizeToTray]);

  // Sync Electron media control events if running inside Windows Electron shell
  useEffect(() => {
    const api = (window as unknown as {
      electronAPI?: {
        onMediaAction?: (cb: (action: string) => void) => () => void;
      };
    }).electronAPI;
    if (!api?.onMediaAction) return;
    return api.onMediaAction((action) => {
      if (action === 'play-pause') void togglePlayPause();
      if (action === 'next') void nextTrack();
      if (action === 'prev') void prevTrack();
    });
  }, [nextTrack, prevTrack, togglePlayPause]);

  const value: ArchiveTuneContextValue = {
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
    showMiniOverlay,
    setShowMiniOverlay,
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

    // Queue suggestions / "Up Next"
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

  return <ArchiveTuneContext.Provider value={value}>{children}</ArchiveTuneContext.Provider>;
};

export function useArchiveTune(): ArchiveTuneContextValue {
  const ctx = useContext(ArchiveTuneContext);
  if (!ctx) {
    throw new Error('useArchiveTune must be used within ArchiveTuneProvider');
  }
  return ctx;
}
