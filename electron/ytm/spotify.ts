import crypto from 'node:crypto';
import type {
  SpotifyConnection,
  SpotifySyncSchedule,
  Track,
  UnmatchedSpotifyTrack,
  YtMusicBrowseItem,
} from '../../src/types/music';
import { pickBestYtMatchForSpotifyTrack } from '../../src/utils/spotifyMapper';
import {
  getPublicSpotifyConnection,
  getSpotifyCredentials,
  setSpotifyCredentials,
  updateSpotifyCredentials,
} from './credentials';
import type {
  ElectronBeforeSendHeadersDetailsLike,
  ElectronBrowserWindowConstructorLike,
  ElectronBrowserWindowInstanceLike,
  ElectronCookieLike,
  ElectronSessionModuleLike,
} from './electronTypes';
import { searchYtm } from './homeSearchQueue';

export const SPOTIFY_PARTITION = 'persist:spotify-login';
export const SPOTIFY_LOGIN_URL =
  'https://accounts.spotify.com/login?continue=' +
  encodeURIComponent('https://open.spotify.com/');

const SPOTIFY_TOKEN_URL = 'https://open.spotify.com/api/token';
const SPOTIFY_SERVER_TIME_URL = 'https://open.spotify.com/api/server-time';
const SPOTIFY_NUANCE_URL =
  'https://gist.githubusercontent.com/sonic-liberation/22ed9c6ba463899e933427f7de1f0eef/raw/nuances.json';
const SPOTIFY_GQL_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
const SPOTIFY_REST_BASE = 'https://api.spotify.com/v1';

const SPOTIFY_WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

/**
 * Exact persisted-query hashes from ArchiveTune SpotifyHashProvider.kt
 */
const GQL_HASHES: Record<string, string> = {
  profileAttributes: '53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  libraryV3: '973e511ca44261fda7eebac8b653155e7caee3675abb4fb110cc1b8c78b091c3',
  fetchPlaylist: '346811f856fb0b7e4f6c59f8ebea78dd081c6e2fb01b77c954b26259d5fc6763',
  fetchLibraryTracks: '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
};

let cachedNuance: { s: string; v: number; fetchedAt: number } | null = null;
let electronBearerCaptureFn: (() => Promise<{ accessToken: string; expiresAt: number } | null>) | null =
  null;

export function configureSpotifyBearerCaptureFallback(
  fn: () => Promise<{ accessToken: string; expiresAt: number } | null>,
): void {
  electronBearerCaptureFn = fn;
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.toUpperCase().replace(/=/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val < 0) continue;
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/**
 * RFC 6238 HMAC-SHA1 6-digit TOTP ported directly from ArchiveTune SpotifyAuth.kt.
 */
function generateTotp(secretBase32: string, serverTimeSec: number): string {
  const key = base32Decode(secretBase32);
  const timeStep = Math.floor(serverTimeSec / 30);
  const timeBuf = Buffer.alloc(8);
  let val = BigInt(timeStep);
  for (let i = 7; i >= 0; i--) {
    timeBuf[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  const hash = crypto.createHmac('sha1', key).update(timeBuf).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

async function fetchNuance(): Promise<{ s: string; v: number }> {
  if (cachedNuance && Date.now() - cachedNuance.fetchedAt < 5 * 60 * 1000) {
    return { s: cachedNuance.s, v: cachedNuance.v };
  }
  const res = await fetch(SPOTIFY_NUANCE_URL, {
    headers: { 'User-Agent': SPOTIFY_WEB_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nuance fetch failed (${res.status})`);
  const data = (await res.json()) as { s?: string; v?: number };
  if (!data.s || typeof data.v !== 'number') {
    throw new Error('Invalid Spotify TOTP nuance payload');
  }
  cachedNuance = { s: data.s, v: data.v, fetchedAt: Date.now() };
  return { s: data.s, v: data.v };
}

async function fetchSpotifyServerTimeSec(): Promise<number> {
  const res = await fetch(SPOTIFY_SERVER_TIME_URL, {
    headers: { 'User-Agent': SPOTIFY_WEB_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return Math.floor(Date.now() / 1000);
  const data = (await res.json()) as { serverTime?: number };
  return data.serverTime || Math.floor(Date.now() / 1000);
}

/**
 * Exchanges sp_dc cookie for Spotify web-player Bearer token via TOTP (ArchiveTune SpotifyAuth.kt),
 * falling back to headless Electron webRequest Bearer capture if TOTP endpoint refuses.
 */
export async function ensureSpotifyAccessToken(forceRefresh = false): Promise<string> {
  const creds = await getSpotifyCredentials();
  if (!creds || !creds.spDc) {
    throw new Error('Spotify is not signed in.');
  }

  if (
    !forceRefresh &&
    creds.accessToken &&
    creds.expiresAt &&
    creds.expiresAt - 60_000 > Date.now()
  ) {
    return creds.accessToken;
  }

  try {
    const [nuance, serverTimeSec] = await Promise.all([
      fetchNuance(),
      fetchSpotifyServerTimeSec(),
    ]);
    const totp = generateTotp(nuance.s, serverTimeSec);
    const tokenUrl =
      `${SPOTIFY_TOKEN_URL}?reason=transport&productType=web-player` +
      `&totp=${totp}&totpServer=${totp}&totpVer=${nuance.v}`;

    const cookieHeader = creds.spKey
      ? `sp_dc=${creds.spDc}; sp_key=${creds.spKey}`
      : `sp_dc=${creds.spDc}`;

    const res = await fetch(tokenUrl, {
      headers: {
        Cookie: cookieHeader,
        'User-Agent': SPOTIFY_WEB_UA,
        Referer: 'https://open.spotify.com/',
        Origin: 'https://open.spotify.com',
        'app-platform': 'WebPlayer',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        accessToken?: string;
        accessTokenExpirationTimestampMs?: number;
        isAnonymous?: boolean;
      };
      if (json.accessToken && !json.isAnonymous) {
        await updateSpotifyCredentials({
          accessToken: json.accessToken,
          expiresAt:
            json.accessTokenExpirationTimestampMs || Date.now() + 55 * 60 * 1000,
          lastError: undefined,
        });
        return json.accessToken;
      }
    }
  } catch {
    // Fall through to webRequest Bearer capture fallback
  }

  if (electronBearerCaptureFn) {
    const captured = await electronBearerCaptureFn().catch(() => null);
    if (captured?.accessToken) {
      await updateSpotifyCredentials({
        accessToken: captured.accessToken,
        expiresAt: captured.expiresAt || Date.now() + 55 * 60 * 1000,
        lastError: undefined,
      });
      return captured.accessToken;
    }
  }

  throw new Error('Spotify session expired or could not obtain access token. Please sign in again.');
}

async function spotifyGql<T = Record<string, unknown>>(
  operationName: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = await ensureSpotifyAccessToken();
  const sha256Hash = GQL_HASHES[operationName];
  if (!sha256Hash) throw new Error(`Unknown Spotify GQL op: ${operationName}`);

  const res = await fetch(SPOTIFY_GQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json;charset=UTF-8',
      'User-Agent': SPOTIFY_WEB_UA,
      'app-platform': 'WebPlayer',
      Origin: 'https://open.spotify.com',
      Referer: 'https://open.spotify.com/',
    },
    body: JSON.stringify({
      variables,
      operationName,
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash,
        },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 401) {
    const freshToken = await ensureSpotifyAccessToken(true);
    const retry = await fetch(SPOTIFY_GQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${freshToken}`,
        'Content-Type': 'application/json;charset=UTF-8',
        'User-Agent': SPOTIFY_WEB_UA,
        'app-platform': 'WebPlayer',
        Origin: 'https://open.spotify.com',
        Referer: 'https://open.spotify.com/',
      },
      body: JSON.stringify({
        variables,
        operationName,
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!retry.ok) throw new Error(`Spotify GQL ${operationName} failed (${retry.status})`);
    return (await retry.json()) as T;
  }

  if (!res.ok) throw new Error(`Spotify GQL ${operationName} failed (${res.status})`);
  return (await res.json()) as T;
}

async function spotifyRest<T = Record<string, unknown>>(pathUrl: string): Promise<T> {
  const token = await ensureSpotifyAccessToken();
  const res = await fetch(`${SPOTIFY_REST_BASE}${pathUrl}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': SPOTIFY_WEB_UA,
      'app-platform': 'WebPlayer',
      Origin: 'https://open.spotify.com',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Spotify REST ${pathUrl} failed (${res.status})`);
  return (await res.json()) as T;
}

async function fetchSpotifyProfile(): Promise<{
  userId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  profileUrl?: string;
}> {
  try {
    const gql = await spotifyGql<{
      data?: {
        me?: {
          profile?: {
            uri?: string;
            name?: string;
            avatar?: { sources?: Array<{ url?: string }> };
          };
        };
      };
    }>('profileAttributes', {});
    const prof = gql.data?.me?.profile;
    if (prof?.uri || prof?.name) {
      const uid = (prof.uri || '').split(':').pop() || 'spotify-user';
      return {
        userId: uid,
        displayName: prof.name || 'Spotify Listener',
        avatarUrl: prof.avatar?.sources?.[0]?.url || '',
        profileUrl: `https://open.spotify.com/user/${uid}`,
      };
    }
  } catch {
    // fallback to REST /me
  }

  const me = await spotifyRest<{
    id?: string;
    display_name?: string;
    email?: string;
    images?: Array<{ url?: string }>;
    external_urls?: { spotify?: string };
  }>('/me').catch(() => ({}));

  return {
    userId: (me as { id?: string }).id || 'spotify-user',
    displayName:
      (me as { display_name?: string }).display_name ||
      (me as { email?: string }).email ||
      'Spotify Listener',
    email: (me as { email?: string }).email,
    avatarUrl: (me as { images?: Array<{ url?: string }> }).images?.[0]?.url || '',
    profileUrl: (me as { external_urls?: { spotify?: string } }).external_urls?.spotify,
  };
}

/**
 * Visible modal BrowserWindow login capturing sp_dc (+ sp_key) cookie into safeStorage.
 */
export async function loginSpotifyWindow(opts: {
  BrowserWindow: ElectronBrowserWindowConstructorLike;
  session: ElectronSessionModuleLike;
  parentWindow?: ElectronBrowserWindowInstanceLike | null;
}): Promise<{ ok: boolean; connection?: SpotifyConnection | null; error?: string }> {
  const { BrowserWindow, session, parentWindow } = opts;

  return await new Promise((resolve) => {
    let finished = false;
    const done = (payload: {
      ok: boolean;
      connection?: SpotifyConnection | null;
      error?: string;
    }) => {
      if (finished) return;
      finished = true;
      resolve(payload);
    };

    const ses = session.fromPartition(SPOTIFY_PARTITION);

    const authWin = new BrowserWindow({
      width: 520,
      height: 700,
      parent: parentWindow || undefined,
      modal: Boolean(parentWindow),
      show: true,
      title: 'Sign in - Spotify',
      backgroundColor: '#121212',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: SPOTIFY_PARTITION,
      },
    });

    const checkLogin = async () => {
      try {
        if (authWin.isDestroyed()) return;
        const currentUrl = authWin.webContents.getURL();
        if (!currentUrl.startsWith('https://open.spotify.com')) return;

        const cookies = await ses.cookies.get({ domain: '.spotify.com' });
        const spDc = cookies.find((c: ElectronCookieLike) => c.name === 'sp_dc' && c.value)?.value || '';
        const spKey = cookies.find((c: ElectronCookieLike) => c.name === 'sp_key' && c.value)?.value || '';
        if (!spDc) return;

        await setSpotifyCredentials({
          userId: 'spotify-pending',
          displayName: 'Spotify Listener',
          spDc,
          spKey,
          syncSchedule: 'MANUAL',
        });

        await ensureSpotifyAccessToken(true);
        const profile = await fetchSpotifyProfile();
        const creds = await getSpotifyCredentials();
        const conn = await setSpotifyCredentials({
          userId: profile.userId,
          displayName: profile.displayName,
          email: profile.email,
          avatarUrl: profile.avatarUrl,
          profileUrl: profile.profileUrl,
          spDc,
          spKey,
          accessToken: creds?.accessToken,
          expiresAt: creds?.expiresAt,
          syncSchedule: 'MANUAL',
        });

        if (!authWin.isDestroyed()) authWin.close();
        done({ ok: true, connection: conn });
      } catch {
        // continue waiting until session is ready
      }
    };

    authWin.webContents.on('did-finish-load', () => {
      void checkLogin();
    });
    authWin.webContents.on('did-navigate', () => {
      void checkLogin();
    });
    authWin.on('closed', () => {
      done({ ok: false, error: 'Spotify sign-in window closed.' });
    });

    void authWin.loadURL(SPOTIFY_LOGIN_URL, { userAgent: SPOTIFY_WEB_UA });
  });
}

/**
 * Fallback helper for Electron: opens hidden open.spotify.com window and captures
 * its Bearer token via webRequest headers if TOTP endpoint is temporarily blocked.
 */
export function createElectronSpotifyBearerCapturer(opts: {
  BrowserWindow: ElectronBrowserWindowConstructorLike;
  session: ElectronSessionModuleLike;
}): () => Promise<{ accessToken: string; expiresAt: number } | null> {
  return async () => {
    const ses = opts.session.fromPartition(SPOTIFY_PARTITION);
    return await new Promise((resolve) => {
      let settled = false;
      const win = new opts.BrowserWindow({
        show: false,
        width: 400,
        height: 400,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: SPOTIFY_PARTITION,
        },
      });

      const finish = (val: { accessToken: string; expiresAt: number } | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (!win.isDestroyed()) win.close();
        } catch {
          // ignore
        }
        resolve(val);
      };

      const timer = setTimeout(() => finish(null), 12000);

      const filter = { urls: ['https://api-partner.spotify.com/*', 'https://api.spotify.com/*'] };
      ses.webRequest.onBeforeSendHeaders(
        filter,
        (
          details: ElectronBeforeSendHeadersDetailsLike,
          cb: (response: { requestHeaders?: Record<string, string>; cancel?: boolean }) => void,
        ) => {
        const authHeader =
          details.requestHeaders['Authorization'] || details.requestHeaders['authorization'];
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7).trim();
          if (token.length > 20) {
            finish({ accessToken: token, expiresAt: Date.now() + 50 * 60 * 1000 });
          }
        }
        cb({ requestHeaders: details.requestHeaders });
      });

      void win.loadURL('https://open.spotify.com/', { userAgent: SPOTIFY_WEB_UA });
    });
  };
}

interface RawSpotifyTrackItem {
  id: string;
  name: string;
  artist: string;
  album: string;
  durationMs: number;
  playlistName?: string;
}

async function fetchLikedSpotifyTracks(limit = 50): Promise<RawSpotifyTrackItem[]> {
  try {
    const gql = await spotifyGql<{
      data?: {
        me?: {
          library?: {
            tracks?: {
              items?: Array<{
                track?: {
                  _uri?: string;
                  data?: {
                    uri?: string;
                    name?: string;
                    duration?: { totalMilliseconds?: number };
                    albumOfTrack?: { name?: string };
                    artists?: { items?: Array<{ profile?: { name?: string } }> };
                  };
                };
              }>;
            };
          };
        };
      };
    }>('fetchLibraryTracks', { offset: 0, limit });

    const items = gql.data?.me?.library?.tracks?.items || [];
    if (items.length > 0) {
      return items
        .map((entry) => {
          const d = entry.track?.data;
          if (!d?.name) return null;
          const uri = entry.track?._uri || d.uri || '';
          const artists = (d.artists?.items || [])
            .map((a) => a.profile?.name || '')
            .filter(Boolean)
            .join(', ');
          return {
            id: uri.split(':').pop() || d.name,
            name: d.name,
            artist: artists || 'Spotify Artist',
            album: d.albumOfTrack?.name || 'Spotify',
            durationMs: d.duration?.totalMilliseconds || 180000,
          };
        })
        .filter((x): x is RawSpotifyTrackItem => Boolean(x));
    }
  } catch {
    // REST fallback
  }

  const rest = await spotifyRest<{
    items?: Array<{
      track?: {
        id?: string;
        name?: string;
        duration_ms?: number;
        album?: { name?: string };
        artists?: Array<{ name?: string }>;
      };
    }>;
  }>(`/me/tracks?limit=${limit}`).catch(() => ({ items: [] }));

  return (rest.items || [])
    .map((entry) => {
      const t = entry.track;
      if (!t?.name) return null;
      return {
        id: t.id || t.name,
        name: t.name,
        artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(', ') || 'Spotify Artist',
        album: t.album?.name || 'Spotify',
        durationMs: t.duration_ms || 180000,
      };
    })
    .filter((x): x is RawSpotifyTrackItem => Boolean(x));
}

async function fetchUserSpotifyPlaylists(): Promise<
  Array<{ id: string; name: string; imageUrl?: string; tracks: RawSpotifyTrackItem[] }>
> {
  const results: Array<{
    id: string;
    name: string;
    imageUrl?: string;
    tracks: RawSpotifyTrackItem[];
  }> = [];

  try {
    const gql = await spotifyGql<{
      data?: {
        me?: {
          libraryV3?: {
            items?: Array<{
              item?: {
                __typename?: string;
                _uri?: string;
                data?: {
                  __typename?: string;
                  uri?: string;
                  name?: string;
                  images?: { items?: Array<{ sources?: Array<{ url?: string }> }> };
                };
              };
            }>;
          };
        };
      };
    }>('libraryV3', {
      filters: ['Playlists'],
      order: null,
      textFilter: '',
      features: ['LIKED_SONGS', 'YOUR_EPISODES_V2', 'PRERELEASES', 'EVENTS'],
      limit: 30,
      offset: 0,
      flatten: false,
      expandedFolders: [],
      folderUri: null,
      includeFoldersWhenFlattening: true,
    });

    const items = gql.data?.me?.libraryV3?.items || [];
    for (const entry of items) {
      const w = entry.item;
      if (!w || w.__typename !== 'PlaylistResponseWrapper') continue;
      const uri = w._uri || w.data?.uri || '';
      const id = uri.split(':').pop() || '';
      const name = w.data?.name || '';
      if (!id || !name || uri.includes(':collection')) continue;
      const img = w.data?.images?.items?.[0]?.sources?.[0]?.url || '';
      const plTracks = await fetchSpotifyPlaylistTracks(id, name);
      results.push({ id, name, imageUrl: img, tracks: plTracks });
    }
    if (results.length > 0) return results;
  } catch {
    // REST fallback
  }

  const rest = await spotifyRest<{
    items?: Array<{ id?: string; name?: string; images?: Array<{ url?: string }> }>;
  }>('/me/playlists?limit=25').catch(() => ({ items: [] }));

  for (const pl of rest.items || []) {
    if (!pl.id || !pl.name) continue;
    const plTracks = await fetchSpotifyPlaylistTracks(pl.id, pl.name);
    results.push({
      id: pl.id,
      name: pl.name,
      imageUrl: pl.images?.[0]?.url || '',
      tracks: plTracks,
    });
  }
  return results;
}

async function fetchSpotifyPlaylistTracks(
  playlistId: string,
  playlistName: string,
): Promise<RawSpotifyTrackItem[]> {
  try {
    const gql = await spotifyGql<{
      data?: {
        playlistV2?: {
          content?: {
            items?: Array<{
              itemV2?: {
                data?: {
                  __typename?: string;
                  uri?: string;
                  name?: string;
                  trackDuration?: { totalMilliseconds?: number };
                  albumOfTrack?: { name?: string };
                  artists?: { items?: Array<{ profile?: { name?: string } }> };
                };
              };
            }>;
          };
        };
      };
    }>('fetchPlaylist', {
      uri: `spotify:playlist:${playlistId}`,
      offset: 0,
      limit: 60,
      enableWatchFeedEntrypoint: false,
    });

    const items = gql.data?.playlistV2?.content?.items || [];
    if (items.length > 0) {
      return items
        .map((it): RawSpotifyTrackItem | null => {
          const d = it.itemV2?.data;
          if (!d?.name || (d.__typename && d.__typename !== 'Track')) return null;
          return {
            id: (d.uri || '').split(':').pop() || d.name,
            name: d.name,
            artist:
              (d.artists?.items || []).map((a) => a.profile?.name).filter(Boolean).join(', ') ||
              'Spotify Artist',
            album: d.albumOfTrack?.name || playlistName,
            durationMs: d.trackDuration?.totalMilliseconds || 180000,
            playlistName,
          };
        })
        .filter((x): x is RawSpotifyTrackItem => x !== null);
    }
  } catch {
    // REST fallback
  }

  const rest = await spotifyRest<{
    items?: Array<{
      track?: {
        id?: string;
        name?: string;
        duration_ms?: number;
        album?: { name?: string };
        artists?: Array<{ name?: string }>;
      };
    }>;
  }>(`/playlists/${playlistId}/tracks?limit=60`).catch(() => ({ items: [] }));

  return (rest.items || [])
    .map((entry): RawSpotifyTrackItem | null => {
      const t = entry.track;
      if (!t?.name) return null;
      return {
        id: t.id || t.name,
        name: t.name,
        artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(', ') || 'Spotify Artist',
        album: t.album?.name || playlistName,
        durationMs: t.duration_ms || 180000,
        playlistName,
      };
    })
    .filter((x): x is RawSpotifyTrackItem => x !== null);
}

async function fetchSavedAlbumsAndArtists(): Promise<{
  savedAlbums: YtMusicBrowseItem[];
  followedArtists: YtMusicBrowseItem[];
}> {
  const [albumsRes, artistsRes] = await Promise.all([
    spotifyRest<{
      items?: Array<{
        album?: {
          id?: string;
          name?: string;
          images?: Array<{ url?: string }>;
          artists?: Array<{ name?: string }>;
        };
      }>;
    }>('/me/albums?limit=25').catch(() => ({ items: [] })),
    spotifyRest<{
      artists?: {
        items?: Array<{ id?: string; name?: string; images?: Array<{ url?: string }> }>;
      };
    }>('/me/following?type=artist&limit=25').catch(() => ({ artists: { items: [] } })),
  ]);

  const savedAlbums: YtMusicBrowseItem[] = (albumsRes.items || [])
    .filter((it) => it.album?.name)
    .map((it) => {
      const alb = it.album!;
      return {
        id: `sp-album-${alb.id || alb.name}`,
        kind: 'album',
        title: alb.name!,
        subtitle: (alb.artists || []).map((a) => a.name).filter(Boolean).join(', ') || 'Spotify Album',
        thumbnailUrl: alb.images?.[0]?.url
          ? `/api/proxy-image?url=${encodeURIComponent(alb.images[0].url)}`
          : '',
      };
    });

  const followedArtists: YtMusicBrowseItem[] = (artistsRes.artists?.items || [])
    .filter((a) => a.name)
    .map((a) => ({
      id: `sp-artist-${a.id || a.name}`,
      kind: 'artist',
      title: a.name!,
      subtitle: 'Followed on Spotify',
      thumbnailUrl: a.images?.[0]?.url
        ? `/api/proxy-image?url=${encodeURIComponent(a.images[0].url)}`
        : '',
    }));

  return { savedAlbums, followedArtists };
}

async function mapSpotifyTrackToYtm(
  spTrack: RawSpotifyTrackItem,
  gl: string,
  hl: string,
): Promise<{ matched: Track | null; unmatched: UnmatchedSpotifyTrack | null }> {
  const query = `${spTrack.artist} ${spTrack.name}`.trim();
  const res = await searchYtm({ query, filter: 'songs', gl, hl }).catch(() => ({
    tracks: [],
    cards: [],
  }));
  const { match, bestCandidate, bestScore } = pickBestYtMatchForSpotifyTrack(
    { name: spTrack.name, artist: spTrack.artist, durationMs: spTrack.durationMs },
    res.tracks,
  );
  if (match) {
    return { matched: match, unmatched: null };
  }
  return {
    matched: null,
    unmatched: {
      id: spTrack.id,
      name: spTrack.name,
      artist: spTrack.artist,
      album: spTrack.album,
      durationMs: spTrack.durationMs,
      playlistName: spTrack.playlistName,
      bestCandidateTitle: bestCandidate?.title,
      bestCandidateArtist: bestCandidate?.artist,
      bestCandidateScore: Number(bestScore.toFixed(2)),
    },
  };
}

export async function syncSpotifyLibraryToYtm(opts: {
  gl?: string;
  hl?: string;
}): Promise<{
  ok: boolean;
  connection: SpotifyConnection | null;
  likedTracks: Track[];
  playlists: Array<{ name: string; imageUrl?: string; tracks: Track[]; spotifyId: string }>;
  savedAlbums: YtMusicBrowseItem[];
  followedArtists: YtMusicBrowseItem[];
  unmatchedTracks: UnmatchedSpotifyTrack[];
  error?: string;
}> {
  const creds = await getSpotifyCredentials();
  if (!creds?.spDc) {
    return {
      ok: false,
      connection: null,
      likedTracks: [],
      playlists: [],
      savedAlbums: [],
      followedArtists: [],
      unmatchedTracks: [],
      error: 'Connect Spotify first to sync your library.',
    };
  }

  const gl = opts.gl || 'US';
  const hl = opts.hl || 'en';

  try {
    const [rawLiked, rawPlaylists, albumsArtists] = await Promise.all([
      fetchLikedSpotifyTracks(40),
      fetchUserSpotifyPlaylists(),
      fetchSavedAlbumsAndArtists(),
    ]);

    const unmatchedTracks: UnmatchedSpotifyTrack[] = [];
    const likedTracks: Track[] = [];
    const seenVideoIds = new Set<string>();

    for (const spTrack of rawLiked.slice(0, 30)) {
      const mapped = await mapSpotifyTrackToYtm(spTrack, gl, hl);
      if (mapped.matched) {
        if (!seenVideoIds.has(mapped.matched.ytMusicVideoId || mapped.matched.id)) {
          seenVideoIds.add(mapped.matched.ytMusicVideoId || mapped.matched.id);
          likedTracks.push({ ...mapped.matched, liked: true });
        }
      } else if (mapped.unmatched) {
        unmatchedTracks.push({ ...mapped.unmatched, playlistName: 'Liked Songs (Spotify)' });
      }
    }

    const playlists: Array<{
      name: string;
      imageUrl?: string;
      tracks: Track[];
      spotifyId: string;
    }> = [];

    for (const pl of rawPlaylists.slice(0, 12)) {
      const matchedPlTracks: Track[] = [];
      for (const spTrack of pl.tracks.slice(0, 35)) {
        const mapped = await mapSpotifyTrackToYtm(spTrack, gl, hl);
        if (mapped.matched) {
          matchedPlTracks.push(mapped.matched);
        } else if (mapped.unmatched) {
          unmatchedTracks.push(mapped.unmatched);
        }
      }
      playlists.push({
        name: pl.name,
        imageUrl: pl.imageUrl
          ? `/api/proxy-image?url=${encodeURIComponent(pl.imageUrl)}`
          : undefined,
        tracks: matchedPlTracks,
        spotifyId: pl.id,
      });
    }

    const totalMatched =
      likedTracks.length + playlists.reduce((acc, p) => acc + p.tracks.length, 0);

    const connection = await updateSpotifyCredentials({
      lastSyncedAt: Date.now(),
      lastSyncedCount: totalMatched,
      unmatchedTracks,
      lastError: undefined,
    });

    return {
      ok: true,
      connection,
      likedTracks,
      playlists,
      savedAlbums: albumsArtists.savedAlbums,
      followedArtists: albumsArtists.followedArtists,
      unmatchedTracks,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Spotify sync failed.';
    const connection = await updateSpotifyCredentials({ lastError: msg });
    return {
      ok: false,
      connection,
      likedTracks: [],
      playlists: [],
      savedAlbums: [],
      followedArtists: [],
      unmatchedTracks: [],
      error: msg,
    };
  }
}

export async function resolveManualSpotifyTrackList(opts: {
  input: string;
  gl?: string;
  hl?: string;
}): Promise<{
  ok: boolean;
  playlistName: string;
  tracks: Track[];
  unmatchedTracks: UnmatchedSpotifyTrack[];
  error?: string;
}> {
  const gl = opts.gl || 'US';
  const hl = opts.hl || 'en';
  const raw = (opts.input || '').trim();
  if (!raw) {
    return {
      ok: false,
      playlistName: 'Imported Playlist',
      tracks: [],
      unmatchedTracks: [],
      error: 'Enter a public Spotify playlist URL or paste tracks as "Artist - Title".',
    };
  }

  let playlistName = 'Spotify Imported Playlist';
  let items: RawSpotifyTrackItem[] = [];

  const urlMatch = raw.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);
  if (urlMatch?.[1]) {
    const playlistId = urlMatch[1];
    // Try authenticated session first if signed in
    if ((await getSpotifyCredentials())?.spDc) {
      items = await fetchSpotifyPlaylistTracks(playlistId, 'Spotify Playlist').catch(() => []);
    }
    // Public embed JSON fallback if not signed into Spotify
    if (items.length === 0) {
      try {
        const embedRes = await fetch(
          `https://open.spotify.com/embed/playlist/${playlistId}`,
          { headers: { 'User-Agent': SPOTIFY_WEB_UA }, signal: AbortSignal.timeout(10000) },
        );
        if (embedRes.ok) {
          const html = await embedRes.text();
          const nextDataMatch = html.match(
            /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
          );
          if (nextDataMatch?.[1]) {
            const parsed = JSON.parse(nextDataMatch[1]) as {
              props?: {
                pageProps?: {
                  state?: {
                    data?: {
                      entity?: {
                        name?: string;
                        trackList?: Array<{
                          title?: string;
                          subtitle?: string;
                          duration?: number;
                          uri?: string;
                        }>;
                      };
                    };
                  };
                };
              };
            };
            const entity = parsed.props?.pageProps?.state?.data?.entity;
            if (entity?.name) playlistName = entity.name;
            items = (entity?.trackList || []).map((t, i) => ({
              id: t.uri || `sp-${i}`,
              name: t.title || '',
              artist: (t.subtitle || '').replace(/\u00a0/g, ' '),
              album: playlistName,
              durationMs: t.duration || 180000,
              playlistName,
            }));
          }
        }
      } catch {
        // ignore
      }
    }
  } else {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    items = lines.map((line, idx) => {
      const parts = line.split(/\s+-\s+/);
      if (parts.length >= 2) {
        return {
          id: `line-${idx}`,
          artist: parts[0].trim(),
          name: parts.slice(1).join(' - ').trim(),
          album: playlistName,
          durationMs: 180000,
          playlistName,
        };
      }
      return {
        id: `line-${idx}`,
        artist: '',
        name: line,
        album: playlistName,
        durationMs: 180000,
        playlistName,
      };
    });
  }

  const tracks: Track[] = [];
  const unmatchedTracks: UnmatchedSpotifyTrack[] = [];

  for (const item of items.slice(0, 60)) {
    if (!item.name) continue;
    const mapped = await mapSpotifyTrackToYtm(item, gl, hl);
    if (mapped.matched) {
      tracks.push(mapped.matched);
    } else if (mapped.unmatched) {
      unmatchedTracks.push(mapped.unmatched);
    }
  }

  return {
    ok: tracks.length > 0 || unmatchedTracks.length > 0,
    playlistName,
    tracks,
    unmatchedTracks,
    error:
      tracks.length === 0 && unmatchedTracks.length === 0
        ? 'Could not extract tracks from that playlist URL or text list.'
        : undefined,
  };
}

export async function setSpotifySyncSchedule(
  schedule: SpotifySyncSchedule,
): Promise<SpotifyConnection | null> {
  return await updateSpotifyCredentials({ syncSchedule: schedule });
}

export async function logoutSpotifyAccount(
  session?: ElectronSessionModuleLike,
): Promise<null> {
  await setSpotifyCredentials(null);
  if (session) {
    try {
      const ses = session.fromPartition(SPOTIFY_PARTITION);
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
    } catch {
      // ignore
    }
  }
  return null;
}

export async function getSpotifyStatus(): Promise<SpotifyConnection | null> {
  return await getPublicSpotifyConnection();
}
