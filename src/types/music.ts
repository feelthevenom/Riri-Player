export type ScreenRoute =
  | 'home'
  | 'explore'
  | 'search'
  | 'library'
  | 'stats'
  | 'plugins'
  | 'settings'
  | 'artist'
  | 'album'
  | 'playlist'
  | 'together';

export type LibraryFilter =
  | 'LIBRARY'
  | 'PLAYLISTS'
  | 'SONGS'
  | 'ARTISTS'
  | 'ALBUMS'
  | 'LOCAL'
  | 'YTMUSIC';

export type StatPeriod =
  | 'WEEK_1'
  | 'MONTH_1'
  | 'MONTH_3'
  | 'MONTH_6'
  | 'YEAR_1'
  | 'ALL';

export type DarkModePreference = 'SYSTEM' | 'DARK' | 'LIGHT';

export type ThemeSurfaceStyle = 'MATERIAL' | 'GLASS' | 'PURE_BLACK';

export type PlayerBackgroundStyle = 'GRADIENT' | 'GLOW' | 'BLUR' | 'SOLID';

export type SliderStyle = 'WAVY' | 'DEFAULT' | 'SLIM';

export type RepeatMode = 'OFF' | 'ALL' | 'ONE';

export type MiniOverlayTheme = 'GLASS' | 'DARK' | 'LIGHT' | 'ACCENT' | 'PURE_BLACK' | 'DYNAMIC_ACCENT';

export type MiniOverlayPin = 'FREE' | 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';

export interface YtMusicAccount {
  id: string;
  name: string;
  handle?: string;
  email?: string;
  avatarUrl?: string;
  authProvider?: 'google' | 'ytmusic';
  cookie: string;
  visitorData?: string;
  poToken?: string;
  authUserIndex?: string;
  dataSyncId?: string;
  addedAt: number;
}

export interface YtMusicBrowseItem {
  id: string;
  kind: 'playlist' | 'album' | 'artist' | 'song' | 'video';
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  browseId?: string;
  videoId?: string;
  params?: string;
  track?: Track;
}

export interface YtMusicHomeSection {
  id: string;
  title: string;
  items: YtMusicBrowseItem[];
}

export interface YtMusicChip {
  title: string;
  browseId: string;
  params?: string;
}

// Queue/Next endpoint types (for YouTube Music style suggestions)
export interface YtMusicQueueChip {
  id: string;
  title: string;
  selected: boolean;
  endpoint: {
    watchEndpoint: {
      videoId?: string;
      playlistId?: string;
      params?: string;
    };
  };
  deselectEndpoint?: {
    watchEndpoint: {
      videoId?: string;
      playlistId?: string;
      params?: string;
    };
  };
}

export interface YtMusicNextResult {
  title?: string;
  items: Track[];
  currentIndex?: number;
  continuation?: string;
  endpoint: {
    watchEndpoint: {
      videoId?: string;
      playlistId?: string;
      params?: string;
    };
  };
  queueChips: YtMusicQueueChip[];
}

export interface SponsorBlockSegment {
  startSec: number;
  endSec: number;
  category: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  durationSec: number;
  thumbnailUrl: string;
  streamUrl: string;
  ytMusicVideoId?: string;
  genre?: string;
  year?: number;
  explicit?: boolean;
  qualityLabel?: string;
  source: 'ytmusic' | 'online' | 'local' | 'plugin';
  pluginId?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
  accentHex?: string;
  liked?: boolean;
  addedAt?: number;
}

export interface PlaylistTag {
  id: string;
  name: string;
  color: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackIds: string[];
  tagIds: string[];
  coverUrl?: string;
  createdAt: number;
  isSystem?: boolean;
  ytBrowseId?: string;
}

export interface PlayEvent {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  thumbnailUrl: string;
  timestamp: number;
  durationPlayedSec: number;
}

export interface EqProfile {
  id: string;
  name: string;
  bandCenterFreqHz: number[];
  bandLevelsDb: number[];
  outputGainDb: number;
  bassBoostDb: number;
  enabled: boolean;
}

export interface ThemeSeedPalette {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  tertiary: string;
  neutral: string;
}

export interface ArchPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  code: string;
  enabled: boolean;
  addedAt: number;
}

export interface AppSettings {
  darkMode: DarkModePreference;
  pureBlack: boolean;
  themeSurfaceStyle: ThemeSurfaceStyle;
  dynamicThemeFromArtwork: boolean;
  themeColor: string;
  playerBackgroundStyle: PlayerBackgroundStyle;
  sliderStyle: SliderStyle;
  playbackSpeed: number;
  preservePitch: boolean;
  volume: number;
  crossfadeSec: number;
  normalizeLoudness: boolean;
  gaplessPlayback: boolean;
  sponsorBlockEnabled: boolean;
  preferredAudioQuality: 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'MAX';
  lyricsOffsetMs: number;
  showSyncedLyricsTranslation: boolean;
  translationLanguage: string;
  lyricsFontScale: number;
  pauseSearchHistory: boolean;
  pauseListenHistory: boolean;
  ytMusicEnabled: boolean;
  contentRegion: string;
  contentLanguage: string;
  ytMusicVisitorData: string;
  ytMusicPoToken: string;
  miniOverlayTheme: MiniOverlayTheme;
  miniOverlayPin: MiniOverlayPin;
  minimizeToTray: boolean;
  offlineStoragePath: string;
  customTogetherServerUrl: string;
  lastFmSessionKey: string;
  lastFmApiKey: string;
  listenBrainzToken: string;
}

export interface LyricLine {
  timeMs: number;
  text: string;
  translation?: string;
}

export interface MoodGenreTile {
  id: string;
  title: string;
  subtitle: string;
  query: string;
  color: string;
  accentColor: string;
}

export interface NavigationView {
  route: ScreenRoute;
  param?: string;
}
