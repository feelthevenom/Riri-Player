import type {
  LibrarySyncProgress,
  SpotifyConnection,
  SpotifySyncSchedule,
  Track,
  UnmatchedSpotifyTrack,
  YtAuthStatusPayload,
  YtMusicBrowseItem,
  YtMusicChip,
  YtMusicHomeSection,
  YtMusicNextResult,
} from '../types/music';
import { audioEngine } from './audioEngine';

export interface ElectronYtmBridge {
  setMinimizeToTray?: (enabled: boolean) => void;
  setFullscreen?: (fullscreen: boolean) => void;
  onFullscreenState?: (cb: (state: boolean) => void) => () => void;
  toggleOverlayWindow?: () => void;
  closeOverlayWindow?: () => void;
  onOverlayState?: (cb: (active: boolean) => void) => () => void;
  onRestoreCinema?: (cb: () => void) => () => void;
  onMediaAction?: (cb: (action: string) => void) => () => void;
  getProxyConfig?: () => Promise<{ baseUrl: string; token: string }>;
  auth?: {
    ytmStatus: () => Promise<YtAuthStatusPayload>;
    ytmLogin: (options?: { cleanPartition?: boolean }) => Promise<{
      ok: boolean;
      status?: YtAuthStatusPayload;
      blocked?: boolean;
      cancelled?: boolean;
      error?: string;
    }>;
    ytmCancel: () => Promise<{ ok: boolean }>;
    ytmImportBrowser: (payload: {
      cookieHeader: string;
      visitorData?: string;
      dataSyncId?: string;
      accountIndex?: number;
    }) => Promise<{ ok: boolean; status?: YtAuthStatusPayload; error?: string }>;
    ytmSwitch: (accountId: string) => Promise<YtAuthStatusPayload>;
    ytmLogout: (accountId?: string) => Promise<YtAuthStatusPayload>;
    spotifyStatus: () => Promise<SpotifyConnection | null>;
    spotifyLogin: () => Promise<{
      ok: boolean;
      connection?: SpotifyConnection | null;
      error?: string;
    }>;
    spotifyLogout: () => Promise<null>;
  };
  library?: {
    sync: (payload?: { gl?: string; hl?: string }) => Promise<{
      ok: boolean;
      likedTracks: Track[];
      playlists: Array<{
        browseId: string;
        playlistId: string;
        title: string;
        subtitle?: string;
        thumbnailUrl?: string;
        tracks: Track[];
      }>;
      savedAlbums: YtMusicBrowseItem[];
      followedArtists: YtMusicBrowseItem[];
      uploadedTracks: Track[];
      historyTracks: Track[];
      syncedAt: number;
      error?: string;
    }>;
    like: (payload: { videoId: string; liked: boolean; gl?: string; hl?: string }) => Promise<{
      ok: boolean;
    }>;
    onProgress: (cb: (progress: LibrarySyncProgress) => void) => () => void;
  };
  home?: {
    feed: (payload?: { params?: string; continuation?: string; gl?: string; hl?: string }) => Promise<{
      sections: YtMusicHomeSection[];
      chips: YtMusicChip[];
      tracks: Track[];
      continuation?: string;
    }>;
    charts: (payload?: { gl?: string; hl?: string }) => Promise<{
      tracks: Track[];
      sections: YtMusicHomeSection[];
    }>;
    browse: (payload: {
      browseId: string;
      continuation?: string;
      gl?: string;
      hl?: string;
    }) => Promise<{
      browseId: string;
      title: string;
      subtitle: string;
      thumbnailUrl: string;
      tracks: Track[];
      items: YtMusicBrowseItem[];
      continuation?: string;
    }>;
  };
  search?: {
    query: (payload: {
      query: string;
      filter?: string;
      continuation?: string;
      gl?: string;
      hl?: string;
    }) => Promise<{ tracks: Track[]; cards: YtMusicBrowseItem[]; continuation?: string }>;
    suggestions: (payload: { query: string; gl?: string; hl?: string }) => Promise<{
      queries?: string[];
      items?: YtMusicBrowseItem[];
      suggestions?: string[];
    } | string[]>;
  };
  queue?: {
    next: (payload: {
      videoId?: string;
      playlistId?: string;
      params?: string;
      continuation?: string;
      gl?: string;
      hl?: string;
    }) => Promise<YtMusicNextResult | null>;
    lyrics: (payload: {
      videoId: string;
      lyricsBrowseId?: string;
      gl?: string;
      hl?: string;
    }) => Promise<{ plainLyrics?: string; source?: string }>;
  };
  spotify?: {
    sync: (payload?: { gl?: string; hl?: string }) => Promise<{
      ok: boolean;
      connection: SpotifyConnection | null;
      likedTracks: Track[];
      playlists: Array<{
        name: string;
        imageUrl?: string;
        tracks: Track[];
        spotifyId: string;
      }>;
      savedAlbums: YtMusicBrowseItem[];
      followedArtists: YtMusicBrowseItem[];
      unmatchedTracks: UnmatchedSpotifyTrack[];
      error?: string;
    }>;
    importPlaylist: (payload: { input: string; gl?: string; hl?: string }) => Promise<{
      ok: boolean;
      playlistName: string;
      tracks: Track[];
      unmatchedTracks: UnmatchedSpotifyTrack[];
      error?: string;
    }>;
    setSchedule: (schedule: SpotifySyncSchedule) => Promise<SpotifyConnection | null>;
    dismissUnmatched: (trackId: string) => Promise<SpotifyConnection | null>;
  };
}

let proxyBaseUrl = '';
let proxyToken = '';

/**
 * Enhances thumbnail URLs to request higher resolution images.
 * YouTube Music thumbnails typically support size parameters like =s88, =s128, =w128-h128, etc.
 * We upgrade them to =s512 or =w512-h512 for better quality.
 */
function enhanceThumbnailUrl(url: string): string {
  if (!url) return url;
  
  // Handle different YouTube thumbnail URL patterns
  return url
    // Pattern: =s{size}-c or =s{size}
    .replace(/=s\d+(-c)?/g, '=s512$1')
    // Pattern: =w{width}-h{height}
    .replace(/=w\d+-h\d+/g, '=w512-h512')
    // Pattern: /s{size}/ in path
    .replace(/\/s\d+\//g, '/s512/')
    // Pattern: /w{width}-h{height}/ in path
    .replace(/\/w\d+-h\d+\//g, '/w512-h512/')
    // Google user content: =s{size}
    .replace(/=s\d+$/, '=s512');
}

function decorateTrackThumb(t: Track): Track {
  const enhancedThumb = t.thumbnailUrl ? enhanceThumbnailUrl(t.thumbnailUrl) : t.thumbnailUrl;
  return enhancedThumb?.startsWith('/api/')
    ? { ...t, thumbnailUrl: decorateProxyUrl(enhancedThumb) }
    : { ...t, thumbnailUrl: enhancedThumb };
}

function decorateBrowseThumb(item: YtMusicBrowseItem): YtMusicBrowseItem {
  const enhancedThumb = item.thumbnailUrl ? enhanceThumbnailUrl(item.thumbnailUrl) : item.thumbnailUrl;
  return {
    ...item,
    thumbnailUrl: enhancedThumb?.startsWith('/api/')
      ? decorateProxyUrl(enhancedThumb)
      : enhancedThumb,
    track: item.track ? decorateTrackThumb(item.track) : undefined,
  };
}

export async function initYtmProxyConfig(maxRetries = 10): Promise<void> {
  const api = getElectronBridge();
  if (!api?.getProxyConfig) return;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const cfg = await api.getProxyConfig();
      if (cfg?.baseUrl) {
        proxyBaseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');
        proxyToken = cfg?.token || '';
        audioEngine.setProxyToken(proxyToken);
        console.log('[Proxy Config] Initialized:', { baseUrl: proxyBaseUrl, hasToken: !!proxyToken });
        return;
      }
    } catch (err) {
      console.warn('[Proxy Config] Retry', i + 1, '/', maxRetries, err);
    }
    // Wait before retry
    await new Promise(r => setTimeout(r, 200));
  }
  console.warn('[Proxy Config] Failed to initialize after', maxRetries, 'retries');
}

export function decorateProxyUrl(url: string): string {
  if (!url) return url;
  if (proxyToken && url.startsWith('/api/')) {
    const base = proxyBaseUrl || '';
    const sep = url.includes('?') ? '&' : '?';
    if (!url.includes('token=')) {
      return `${base}${url}${sep}token=${encodeURIComponent(proxyToken)}`;
    }
    return `${base}${url}`;
  }
  return url;
}

export async function apiFetch(inputUrl: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (proxyToken && inputUrl.startsWith('/api/')) {
    headers.set('x-riri-launch-secret', proxyToken);
  }
  const url = proxyBaseUrl && inputUrl.startsWith('/api/') ? `${proxyBaseUrl}${inputUrl}` : inputUrl;
  return await fetch(url, { ...init, headers });
}

export const ytmClient = {
  isElectronAvailable: () => Boolean(getElectronBridge()?.auth),

  async getYtmStatus(): Promise<YtAuthStatusPayload> {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.ytmStatus();
    const res = await apiFetch('/api/auth/ytm/status');
    return (await res.json()) as YtAuthStatusPayload;
  },

  async loginYtm(options?: { cleanPartition?: boolean }) {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.ytmLogin(options);
    return {
      ok: false,
      blocked: true,
      error:
        'YouTube Music sign-in requires running Riri Player in the desktop app (npm run dev:electron).',
    };
  },

  async ytmCancel() {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.ytmCancel();
    return { ok: false };
  },

  async importYtmBrowserSession(payload: {
    cookieHeader: string;
    visitorData?: string;
    dataSyncId?: string;
    accountIndex?: number;
  }) {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.ytmImportBrowser(payload);
    const res = await apiFetch('/api/auth/ytm/import-browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as {
      ok: boolean;
      status?: YtAuthStatusPayload;
      error?: string;
    };
  },

  async switchYtmAccount(accountId: string): Promise<YtAuthStatusPayload> {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.ytmSwitch(accountId);
    const res = await apiFetch('/api/auth/ytm/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    return (await res.json()) as YtAuthStatusPayload;
  },

  async logoutYtmAccount(accountId?: string): Promise<YtAuthStatusPayload> {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.ytmLogout(accountId);
    const res = await apiFetch('/api/auth/ytm/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    return (await res.json()) as YtAuthStatusPayload;
  },

  async syncYtmLibrary(gl = 'US', hl = 'en') {
    const api = getElectronBridge();
    const data = api?.library
      ? await api.library.sync({ gl, hl })
      : await (
          await apiFetch('/api/ytmusic/library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gl, hl }),
          })
        ).json();
    const raw = data as NonNullable<ElectronYtmBridge['library']> extends {
      sync: (p?: { gl?: string; hl?: string }) => Promise<infer R>;
    }
      ? R
      : never;
    return {
      ...raw,
      likedTracks: (raw.likedTracks || []).map(decorateTrackThumb),
      playlists: (raw.playlists || []).map((pl) => ({
        ...pl,
        thumbnailUrl: pl.thumbnailUrl ? pl.thumbnailUrl : undefined,
        tracks: (pl.tracks || []).map(decorateTrackThumb),
      })),
      savedAlbums: (raw.savedAlbums || []).map(decorateBrowseThumb),
      followedArtists: (raw.followedArtists || []).map(decorateBrowseThumb),
      uploadedTracks: (raw.uploadedTracks || []).map(decorateTrackThumb),
      historyTracks: (raw.historyTracks || []).map(decorateTrackThumb),
    };
  },

  async likeYtmTrack(videoId: string, liked: boolean, gl = 'US', hl = 'en') {
    const api = getElectronBridge();
    if (api?.library) return await api.library.like({ videoId, liked, gl, hl });
    const res = await apiFetch('/api/ytmusic/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, liked, gl, hl }),
    });
    return (await res.json()) as { ok: boolean };
  },

  async getHomeFeed(payload: { params?: string; continuation?: string; gl?: string; hl?: string }) {
    const api = getElectronBridge();
    let data: {
      sections: YtMusicHomeSection[];
      chips: YtMusicChip[];
      tracks: Track[];
      continuation?: string;
    };
    if (api?.home) {
      data = await api.home.feed(payload);
    } else {
      const qs = new URLSearchParams({
        gl: payload.gl || 'US',
        hl: payload.hl || 'en',
      });
      if (payload.params) qs.set('params', payload.params);
      if (payload.continuation) qs.set('continuation', payload.continuation);
      const res = await apiFetch(`/api/ytmusic/home?${qs.toString()}`);
      if (!res.ok) throw new Error('Failed to load YouTube Music Home');
      data = await res.json();
    }
    return {
      ...data,
      sections: (data.sections || []).map((sec) => ({
        ...sec,
        items: (sec.items || []).map(decorateBrowseThumb),
      })),
      tracks: (data.tracks || []).map(decorateTrackThumb),
    };
  },

  async getCharts(gl = 'US', hl = 'en') {
    const api = getElectronBridge();
    const data = api?.home
      ? await api.home.charts({ gl, hl })
      : await (async () => {
          const qs = new URLSearchParams({ gl, hl });
          const res = await apiFetch(`/api/ytmusic/charts?${qs.toString()}`);
          if (!res.ok) throw new Error('Failed to load charts');
          return (await res.json()) as { tracks: Track[]; sections: YtMusicHomeSection[] };
        })();
    return {
      tracks: (data.tracks || []).map(decorateTrackThumb),
      sections: (data.sections || []).map((sec) => ({
        ...sec,
        items: (sec.items || []).map(decorateBrowseThumb),
      })),
    };
  },

  async browseCollection(payload: {
    browseId: string;
    continuation?: string;
    gl?: string;
    hl?: string;
  }) {
    const api = getElectronBridge();
    const data = api?.home
      ? await api.home.browse(payload)
      : await (async () => {
          const qs = new URLSearchParams({
            browseId: payload.browseId,
            gl: payload.gl || 'US',
            hl: payload.hl || 'en',
          });
          if (payload.continuation) qs.set('continuation', payload.continuation);
          const res = await apiFetch(`/api/ytmusic/browse?${qs.toString()}`);
          if (!res.ok) throw new Error('Browse failed');
          return (await res.json()) as {
            browseId: string;
            title: string;
            subtitle: string;
            thumbnailUrl: string;
            tracks: Track[];
            items: YtMusicBrowseItem[];
            continuation?: string;
          };
        })();
    return {
      ...data,
      thumbnailUrl: data.thumbnailUrl ? data.thumbnailUrl : '',
      tracks: (data.tracks || []).map(decorateTrackThumb),
      items: (data.items || []).map(decorateBrowseThumb),
    };
  },

  async searchYtm(payload: {
    query: string;
    filter?: string;
    continuation?: string;
    gl?: string;
    hl?: string;
  }) {
    const api = getElectronBridge();
    let data: { tracks: Track[]; cards: YtMusicBrowseItem[]; continuation?: string };
    if (api?.search) {
      data = await api.search.query(payload);
    } else {
      const qs = new URLSearchParams({
        q: payload.query,
        filter: payload.filter || 'songs',
        gl: payload.gl || 'US',
        hl: payload.hl || 'en',
      });
      if (payload.continuation) qs.set('continuation', payload.continuation);
      const res = await apiFetch(`/api/ytmusic/search?${qs.toString()}`);
      data = res.ok ? await res.json() : { tracks: [], cards: [] };
    }
    return {
      ...data,
      tracks: (data.tracks || []).map(decorateTrackThumb),
      cards: (data.cards || []).map(decorateBrowseThumb),
    };
  },

  async getSearchSuggestions(
    query: string,
    gl = 'US',
    hl = 'en',
  ): Promise<{ queries: string[]; items: YtMusicBrowseItem[] }> {
    const api = getElectronBridge();
    let raw: { queries?: string[]; items?: YtMusicBrowseItem[]; suggestions?: string[] } | string[];
    if (api?.search) {
      raw = (await api.search.suggestions({ query, gl, hl })) as {
        queries?: string[];
        items?: YtMusicBrowseItem[];
        suggestions?: string[];
      } | string[];
    } else {
      const qs = new URLSearchParams({ q: query, gl, hl });
      const res = await apiFetch(`/api/ytmusic/suggestions?${qs.toString()}`);
      raw = res.ok ? await res.json() : { queries: [], items: [] };
    }
    if (Array.isArray(raw)) {
      return { queries: raw, items: [] };
    }
    const queries = raw.queries || raw.suggestions || [];
    const items = (raw.items || []).map(decorateBrowseThumb);
    return { queries, items };
  },

  async getQueueNext(payload: {
    videoId?: string;
    playlistId?: string;
    params?: string;
    continuation?: string;
    gl?: string;
    hl?: string;
  }): Promise<YtMusicNextResult | null> {
    const api = getElectronBridge();
    let result: YtMusicNextResult | null = null;
    if (api?.queue) {
      result = await api.queue.next(payload);
    } else {
      const qs = new URLSearchParams({
        gl: payload.gl || 'US',
        hl: payload.hl || 'en',
      });
      if (payload.videoId) qs.set('videoId', payload.videoId);
      if (payload.playlistId) qs.set('playlistId', payload.playlistId);
      if (payload.params) qs.set('params', payload.params);
      if (payload.continuation) qs.set('continuation', payload.continuation);
      const res = await apiFetch(`/api/ytmusic/next?${qs.toString()}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { result?: YtMusicNextResult | null };
      result = data.result || null;
    }
    if (!result) return null;
    return {
      ...result,
      items: (result.items || []).map(decorateTrackThumb),
    };
  },

  async getLyrics(payload: {
    title: string;
    artist: string;
    videoId?: string;
    lyricsBrowseId?: string;
    gl?: string;
    hl?: string;
  }): Promise<{ syncedLyrics?: string; plainLyrics?: string; source?: string }> {
    try {
      const qs = new URLSearchParams({
        title: payload.title,
        artist: payload.artist,
        gl: payload.gl || 'US',
        hl: payload.hl || 'en',
      });
      if (payload.videoId) qs.set('videoId', payload.videoId);
      const res = await apiFetch(`/api/lyrics?${qs.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as {
          syncedLyrics?: string;
          plainLyrics?: string;
          source?: string;
        };
        if (data.syncedLyrics || data.plainLyrics) return data;
      }
    } catch {
      // fall back to Electron queue:lyrics
    }
    const api = getElectronBridge();
    if (api?.queue && payload.videoId) {
      return await api.queue.lyrics({
        videoId: payload.videoId,
        lyricsBrowseId: payload.lyricsBrowseId,
        gl: payload.gl,
        hl: payload.hl,
      });
    }
    return {};
  },

  async getSponsorBlock(videoId: string) {
    try {
      const res = await apiFetch(`/api/sponsorblock?videoId=${encodeURIComponent(videoId)}`);
      if (!res.ok) return [];
      const d = (await res.json()) as {
        segments?: Array<{ startSec: number; endSec: number; category: string }>;
      };
      return d.segments || [];
    } catch {
      return [];
    }
  },

  async resolveStream(payload: {
    videoId: string;
    quality?: string;
    gl?: string;
    hl?: string;
    expectedDurationSec?: number;
    forceRefresh?: boolean;
  }) {
    const qs = new URLSearchParams({
      videoId: payload.videoId,
      quality: payload.quality || 'HIGH',
      gl: payload.gl || 'US',
      hl: payload.hl || 'en',
      durationSec: String(payload.expectedDurationSec || 0),
    });
    if (payload.forceRefresh) qs.set('refresh', '1');
    const res = await apiFetch(`/api/ytmusic/resolve-stream?${qs.toString()}`);
    return (await res.json()) as {
      ok: boolean;
      videoId: string;
      url?: string;
      qualityLabel?: string;
      bitrateBps?: number;
      error?: string;
    };
  },

  async getSpotifyStatus(): Promise<SpotifyConnection | null> {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.spotifyStatus();
    const res = await apiFetch('/api/spotify/status');
    const data = (await res.json()) as { connection?: SpotifyConnection | null };
    return data.connection || null;
  },

  async loginSpotify() {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.spotifyLogin();
    return {
      ok: false,
      error: 'Spotify account sign-in opens an embedded login window in the Riri Player desktop app.',
    };
  },

  async logoutSpotify() {
    const api = getElectronBridge();
    if (api?.auth) return await api.auth.spotifyLogout();
    await apiFetch('/api/spotify/logout', { method: 'POST' });
    return null;
  },

  async syncSpotify(gl = 'US', hl = 'en') {
    const api = getElectronBridge();
    const data = api?.spotify
      ? await api.spotify.sync({ gl, hl })
      : ((await (
          await apiFetch('/api/spotify/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gl, hl }),
          })
        ).json()) as {
          ok: boolean;
          connection: SpotifyConnection | null;
          likedTracks: Track[];
          playlists: Array<{
            name: string;
            imageUrl?: string;
            tracks: Track[];
            spotifyId: string;
          }>;
          savedAlbums: YtMusicBrowseItem[];
          followedArtists: YtMusicBrowseItem[];
          unmatchedTracks: UnmatchedSpotifyTrack[];
          error?: string;
        });
    return {
      ...data,
      likedTracks: (data.likedTracks || []).map(decorateTrackThumb),
      playlists: (data.playlists || []).map((pl) => ({
        ...pl,
        imageUrl: pl.imageUrl ? pl.imageUrl : undefined,
        tracks: (pl.tracks || []).map(decorateTrackThumb),
      })),
      savedAlbums: (data.savedAlbums || []).map(decorateBrowseThumb),
      followedArtists: (data.followedArtists || []).map(decorateBrowseThumb),
    };
  },

  async importSpotifyPlaylist(input: string, gl = 'US', hl = 'en') {
    const api = getElectronBridge();
    const data = api?.spotify
      ? await api.spotify.importPlaylist({ input, gl, hl })
      : ((await (
          await apiFetch('/api/spotify/import-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input, gl, hl }),
          })
        ).json()) as {
          ok: boolean;
          playlistName: string;
          tracks: Track[];
          unmatchedTracks: UnmatchedSpotifyTrack[];
          error?: string;
        });
    return {
      ...data,
      tracks: (data.tracks || []).map(decorateTrackThumb),
    };
  },

  async setSpotifySchedule(schedule: SpotifySyncSchedule): Promise<SpotifyConnection | null> {
    const api = getElectronBridge();
    if (api?.spotify) return await api.spotify.setSchedule(schedule);
    const res = await apiFetch('/api/spotify/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncSchedule: schedule }),
    });
    const data = (await res.json()) as { connection?: SpotifyConnection | null };
    return data.connection || null;
  },

  async dismissSpotifyUnmatched(trackId: string): Promise<SpotifyConnection | null> {
    const api = getElectronBridge();
    if (api?.spotify) return await api.spotify.dismissUnmatched(trackId);
    const res = await apiFetch('/api/spotify/dismiss-unmatched', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId }),
    });
    const data = (await res.json()) as { connection?: SpotifyConnection | null };
    return data.connection || null;
  },
};

export function getElectronBridge(): ElectronYtmBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: ElectronYtmBridge }).electronAPI;
}