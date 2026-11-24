import {
  AppSettings,
  EqProfile,
  MiniOverlayTheme,
  MoodGenreTile,
  Playlist,
  PlaylistTag,
  ThemeSeedPalette,
} from '../types/music';

export const DEFAULT_THEME_COLOR = '#ED5564';

export const THEME_PRESETS: ThemeSeedPalette[] = [
  {
    id: 'riri-coral',
    name: 'Riri Coral',
    primary: '#ED5564',
    secondary: '#E5BDC0',
    tertiary: '#EAB98A',
    neutral: '#121011',
  },
  {
    id: 'spotify-emerald',
    name: 'Emerald Pulse',
    primary: '#1DB954',
    secondary: '#A7F3D0',
    tertiary: '#6EE7B7',
    neutral: '#0E1412',
  },
  {
    id: 'koiverse-indigo',
    name: 'Koiverse Indigo',
    primary: '#6366F1',
    secondary: '#C7C8F9',
    tertiary: '#F0ABFC',
    neutral: '#111118',
  },
  {
    id: 'tube-amber',
    name: 'Tube Amber',
    primary: '#F59E0B',
    secondary: '#FDE68A',
    tertiary: '#FB923C',
    neutral: '#15120E',
  },
  {
    id: 'velvet-violet',
    name: 'Velvet Violet',
    primary: '#A855F7',
    secondary: '#E9D5FF',
    tertiary: '#F472B6',
    neutral: '#141017',
  },
  {
    id: 'ocean-cyan',
    name: 'Ocean Cyan',
    primary: '#06B6D4',
    secondary: '#BAE6FD',
    tertiary: '#818CF8',
    neutral: '#0E1416',
  },
];

export const HOME_CHIPS = [
  { id: 'all', title: 'All', query: 'electronic indie pop' },
  { id: 'relax', title: 'Relax', query: 'lofi chill ambient' },
  { id: 'energize', title: 'Energize', query: 'synthwave upbeat dance' },
  { id: 'workout', title: 'Workout', query: 'electronic house workout' },
  { id: 'focus', title: 'Focus', query: 'instrumental piano study' },
  { id: 'commute', title: 'Commute', query: 'indie rock alternative' },
];

export const OVERLAY_THEME_CLASSES: Record<
  MiniOverlayTheme,
  { container: string; muted: string; label: string }
> = {
  GLASS: {
    container:
      'bg-[#18181d]/60 backdrop-blur-[36px] backdrop-saturate-[190%] border border-white/[0.22] text-white shadow-[0_20px_44px_-10px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.34)]',
    muted: 'text-white/65',
    label: 'Glass',
  },
  DARK: {
    container:
      'bg-[#181416] border border-white/10 text-[#F5EFF1] shadow-2xl',
    muted: 'text-[#C7BAC0]',
    label: 'Dark',
  },
  LIGHT: {
    container:
      'bg-white/85 backdrop-blur-2xl backdrop-saturate-150 border border-black/10 text-[#1C1618] shadow-[0_20px_44px_-10px_rgba(0,0,0,0.22),inset_0_1px_0_0_rgba(255,255,255,0.8)]',
    muted: 'text-[#57484D]',
    label: 'Light',
  },
  ACCENT: {
    container:
      'bg-gradient-to-br from-[var(--md-primary-container)] to-[#120E10] border border-[var(--md-primary)]/40 text-white shadow-2xl',
    muted: 'text-white/75',
    label: 'Accent',
  },
  PURE_BLACK: {
    container:
      'bg-black border border-white/15 text-white shadow-2xl',
    muted: 'text-zinc-400',
    label: 'Black',
  },
  DYNAMIC_ACCENT: {
    container: '',
    muted: '',
    label: 'Dynamic Accent',
  },
  RIRI_GLASS: {
    container: 'riri-glass text-white',
    muted: 'text-white/60',
    label: 'Riri Glass',
  },
};

export const MOODS_AND_GENRES: MoodGenreTile[] = [
  {
    id: 'chill',
    title: 'Chill & Lo-Fi',
    subtitle: 'Late night beats & tape warmth',
    query: 'lofi chill beats',
    color: '#2A212B',
    accentColor: '#E5989B',
  },
  {
    id: 'jpop',
    title: 'J-Pop & City Pop',
    subtitle: 'Tokyo neon skyline',
    query: 'city pop jpop',
    color: '#1E2A3A',
    accentColor: '#72EFDD',
  },
  {
    id: 'synthwave',
    title: 'Synthwave & Retrowave',
    subtitle: 'Analog arpeggios',
    query: 'synthwave retrowave',
    color: '#341D38',
    accentColor: '#F72585',
  },
  {
    id: 'indie',
    title: 'Indie & Alternative',
    subtitle: 'Dream pop & guitar hooks',
    query: 'indie dream pop',
    color: '#253129',
    accentColor: '#95D5B2',
  },
  {
    id: 'electronic',
    title: 'Electronic & House',
    subtitle: 'Deep grooves & modular',
    query: 'deep house electronic',
    color: '#1F2638',
    accentColor: '#60A5FA',
  },
  {
    id: 'jazz',
    title: 'Jazz & Neo-Soul',
    subtitle: 'Warm brass & Rhodes',
    query: 'neo soul jazz',
    color: '#36271C',
    accentColor: '#F4A261',
  },
  {
    id: 'soundtrack',
    title: 'Anime & Game OST',
    subtitle: 'Orchestral & chiptune',
    query: 'anime soundtrack',
    color: '#3A1E24',
    accentColor: '#ED5564',
  },
  {
    id: 'hiphop',
    title: 'Hip-Hop & R&B',
    subtitle: '808s & velvet vocals',
    query: 'rnb hip hop',
    color: '#2B221E',
    accentColor: '#E9C46A',
  },
  {
    id: 'classical',
    title: 'Modern Classical',
    subtitle: 'Felt piano & strings',
    query: 'modern classical piano',
    color: '#242933',
    accentColor: '#CBD5E1',
  },
  {
    id: 'rock',
    title: 'Post-Rock & Shoegaze',
    subtitle: 'Wall of reverb',
    query: 'shoegaze post rock',
    color: '#2C1F27',
    accentColor: '#F472B6',
  },
];

export const DEFAULT_TAGS: PlaylistTag[] = [
  { id: 'tag-chill', name: 'Chill', color: '#72EFDD' },
  { id: 'tag-night', name: 'Late Night', color: '#818CF8' },
  { id: 'tag-focus', name: 'Focus', color: '#95D5B2' },
  { id: 'tag-hires', name: 'Hi-Res', color: '#ED5564' },
];

export const DEFAULT_PLAYLISTS: Playlist[] = [
  {
    id: 'pl-liked',
    name: 'Liked Songs',
    description: 'Your favorite tracks saved locally in Riri Player',
    trackIds: [],
    tagIds: ['tag-hires'],
    createdAt: Date.now(),
    isSystem: true,
  },
];

// 10-band Graphic / Parametric EQ frequencies (32Hz to 16kHz)
export const EQ_CENTER_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const DEFAULT_EQ_PROFILES: EqProfile[] = [
  {
    id: 'eq-flat',
    name: 'Flat',
    bandCenterFreqHz: EQ_CENTER_FREQS,
    bandLevelsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    outputGainDb: 0,
    bassBoostDb: 0,
    enabled: false,
  },
  {
    id: 'eq-bass',
    name: 'Bass Boost',
    bandCenterFreqHz: EQ_CENTER_FREQS,
    bandLevelsDb: [6.0, 5.5, 4.0, 2.0, 0.5, 0, 0, 0.5, 1.0, 1.5],
    outputGainDb: -1.5,
    bassBoostDb: 4.5,
    enabled: true,
  },
  {
    id: 'eq-rock',
    name: 'Rock',
    bandCenterFreqHz: EQ_CENTER_FREQS,
    bandLevelsDb: [4.5, 3.5, 2.0, -0.5, -1.5, 0.5, 2.5, 3.5, 4.0, 3.5],
    outputGainDb: -1.0,
    bassBoostDb: 2.0,
    enabled: true,
  },
  {
    id: 'eq-pop',
    name: 'Pop',
    bandCenterFreqHz: EQ_CENTER_FREQS,
    bandLevelsDb: [-1.0, 1.5, 3.0, 3.5, 2.0, 0, -1.0, 1.0, 2.5, 3.0],
    outputGainDb: 0,
    bassBoostDb: 1.5,
    enabled: true,
  },
  {
    id: 'eq-jazz',
    name: 'Jazz',
    bandCenterFreqHz: EQ_CENTER_FREQS,
    bandLevelsDb: [3.0, 2.5, 1.5, 1.0, -1.0, -1.0, 0.5, 2.0, 3.0, 3.5],
    outputGainDb: 0,
    bassBoostDb: 1.0,
    enabled: true,
  },
  {
    id: 'eq-classical',
    name: 'Classical',
    bandCenterFreqHz: EQ_CENTER_FREQS,
    bandLevelsDb: [3.5, 2.5, 1.0, 0, -0.5, 0, 1.0, 2.5, 3.5, 4.0],
    outputGainDb: 0,
    bassBoostDb: 0,
    enabled: true,
  },
  {
    id: 'eq-riri-warm',
    name: 'Riri Warm',
    bandCenterFreqHz: EQ_CENTER_FREQS,
    bandLevelsDb: [3.0, 2.5, 1.5, 0.5, -0.5, 0.5, 1.5, 2.5, 3.0, 2.5],
    outputGainDb: 0,
    bassBoostDb: 2.0,
    enabled: true,
  },
];

export const YTM_REGIONS: Array<{ code: string; name: string }> = [
  { code: 'US', name: 'United States (US)' },
  { code: 'IN', name: 'India (IN)' },
  { code: 'GB', name: 'United Kingdom (GB)' },
  { code: 'JP', name: 'Japan (JP)' },
  { code: 'KR', name: 'South Korea (KR)' },
  { code: 'CA', name: 'Canada (CA)' },
  { code: 'DE', name: 'Germany (DE)' },
  { code: 'FR', name: 'France (FR)' },
  { code: 'BR', name: 'Brazil (BR)' },
  { code: 'AU', name: 'Australia (AU)' },
  { code: 'ID', name: 'Indonesia (ID)' },
  { code: 'PH', name: 'Philippines (PH)' },
  { code: 'TW', name: 'Taiwan (TW)' },
  { code: 'MX', name: 'Mexico (MX)' },
  { code: 'ES', name: 'Spain (ES)' },
];

export const YTM_LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'id', name: 'Indonesian' },
];

export const DEFAULT_SETTINGS: AppSettings = {
  darkMode: 'DARK',
  pureBlack: false,
  themeSurfaceStyle: 'MATERIAL',
  dynamicThemeFromArtwork: true,
  themeColor: DEFAULT_THEME_COLOR,
  playerBackgroundStyle: 'GRADIENT',
  sliderStyle: 'WAVY',
  playbackSpeed: 1.0,
  preservePitch: true,
  volume: 0.85,
  crossfadeSec: 0,
  normalizeLoudness: true,
  gaplessPlayback: true,
  sponsorBlockEnabled: true,
  preferredAudioQuality: 'HIGH',
  lyricsOffsetMs: 0,
  showSyncedLyricsTranslation: false,
  translationLanguage: 'ENGLISH',
  lyricsFontScale: 1.0,
  pauseSearchHistory: false,
  pauseListenHistory: false,
  ytMusicEnabled: true,
  contentRegion: 'US',
  contentLanguage: 'en',
  miniOverlayTheme: 'DYNAMIC_ACCENT',
  miniOverlayPin: 'FREE',
  minimizeToTray: false,
  offlineStoragePath: '',
  customTogetherServerUrl: '',
  lastFmSessionKey: '',
  lastFmApiKey: '',
  listenBrainzToken: '',
};

export const FALLBACK_ARTWORK_DATA_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2b1920"/><stop offset="100%" stop-color="#141011"/></linearGradient></defs>
      <rect width="400" height="400" fill="url(#g)"/>
      <circle cx="200" cy="200" r="96" fill="none" stroke="#ED5564" stroke-width="6" stroke-opacity="0.5"/>
      <circle cx="200" cy="200" r="22" fill="#ED5564" fill-opacity="0.75"/>
    </svg>`,
  );
