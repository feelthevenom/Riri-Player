import {
  ArchPlugin,
  PlayEvent,
  Playlist,
  PlaylistTag,
  RepeatMode,
  SpotifyConnection,
  Track,
  UnmatchedSpotifyTrack,
  YtAccountSummary,
  YtMusicBrowseItem,
} from '../types/music';

const DB_NAME = 'riri_player_db';
const DB_VERSION = 1;

const STORES = {
  KV: 'kv',
  LOCAL_BLOBS: 'local_blobs',
} as const;

const pendingLibraryWrites = new Set<Promise<void>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item))))
    : [];
}

function sanitizeTrack(value: unknown): Track | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  const source =
    record.source === 'ytmusic' || record.source === 'local' || record.source === 'plugin'
      ? record.source
      : 'plugin';
  return {
    id: record.id,
    title: optionalString(record.title) || 'Unknown title',
    artist: optionalString(record.artist) || 'Unknown artist',
    album: optionalString(record.album) || '',
    durationSec: optionalNumber(record.durationSec) || 0,
    thumbnailUrl: optionalString(record.thumbnailUrl) || '',
    streamUrl: optionalString(record.streamUrl) || '',
    source,
    ...(optionalString(record.artistId) ? { artistId: optionalString(record.artistId) } : {}),
    ...(optionalString(record.albumId) ? { albumId: optionalString(record.albumId) } : {}),
    ...(optionalString(record.ytMusicVideoId)
      ? { ytMusicVideoId: optionalString(record.ytMusicVideoId) }
      : {}),
    ...(optionalString(record.ytAccountId)
      ? { ytAccountId: optionalString(record.ytAccountId) }
      : {}),
    ...(optionalString(record.genre) ? { genre: optionalString(record.genre) } : {}),
    ...(optionalNumber(record.year) !== undefined ? { year: optionalNumber(record.year) } : {}),
    ...(optionalBoolean(record.explicit) !== undefined
      ? { explicit: optionalBoolean(record.explicit) }
      : {}),
    ...(optionalString(record.qualityLabel)
      ? { qualityLabel: optionalString(record.qualityLabel) }
      : {}),
    ...(optionalString(record.pluginId) ? { pluginId: optionalString(record.pluginId) } : {}),
    ...(optionalString(record.syncedLyrics)
      ? { syncedLyrics: optionalString(record.syncedLyrics) }
      : {}),
    ...(optionalString(record.plainLyrics)
      ? { plainLyrics: optionalString(record.plainLyrics) }
      : {}),
    ...(optionalString(record.accentHex)
      ? { accentHex: optionalString(record.accentHex) }
      : {}),
    ...(optionalBoolean(record.liked) !== undefined ? { liked: optionalBoolean(record.liked) } : {}),
    ...(optionalNumber(record.addedAt) !== undefined ? { addedAt: optionalNumber(record.addedAt) } : {}),
  };
}

function sanitizeTracks(value: unknown): Track[] {
  return Array.isArray(value)
    ? value.map((track) => sanitizeTrack(track)).filter((track): track is Track => Boolean(track))
    : [];
}

function sanitizePlaylist(value: unknown): Playlist | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    name: optionalString(record.name) || 'Untitled Playlist',
    description: optionalString(record.description),
    trackIds: stringArray(record.trackIds),
    tagIds: stringArray(record.tagIds),
    coverUrl: optionalString(record.coverUrl),
    createdAt: optionalNumber(record.createdAt) || Date.now(),
    isSystem: optionalBoolean(record.isSystem),
    ytBrowseId: optionalString(record.ytBrowseId),
    ytPlaylistId: optionalString(record.ytPlaylistId),
    spotifyId: optionalString(record.spotifyId),
  };
}

function sanitizePlaylists(value: unknown): Playlist[] {
  return Array.isArray(value)
    ? value
        .map((playlist) => sanitizePlaylist(playlist))
        .filter((playlist): playlist is Playlist => Boolean(playlist))
    : [];
}

function sanitizeTag(value: unknown): PlaylistTag | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    name: optionalString(record.name) || 'Tag',
    color: optionalString(record.color) || '#7c5cff',
  };
}

function sanitizePlayEvent(value: unknown): PlayEvent | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    trackId: optionalString(record.trackId) || '',
    title: optionalString(record.title) || 'Unknown title',
    artist: optionalString(record.artist) || 'Unknown artist',
    album: optionalString(record.album) || '',
    thumbnailUrl: optionalString(record.thumbnailUrl) || '',
    timestamp: optionalNumber(record.timestamp) || Date.now(),
    durationPlayedSec: optionalNumber(record.durationPlayedSec) || 0,
  };
}

function sanitizePlugin(value: unknown): ArchPlugin | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    name: optionalString(record.name) || 'Unnamed plugin',
    version: optionalString(record.version) || '0.0.0',
    author: optionalString(record.author) || 'Unknown',
    description: optionalString(record.description) || '',
    code: optionalString(record.code) || '',
    enabled: optionalBoolean(record.enabled) || false,
    addedAt: optionalNumber(record.addedAt) || Date.now(),
  };
}

function sanitizeBrowseItem(value: unknown): YtMusicBrowseItem | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  const kind =
    record.kind === 'playlist' ||
    record.kind === 'album' ||
    record.kind === 'artist' ||
    record.kind === 'song' ||
    record.kind === 'video'
      ? record.kind
      : 'video';
  const nestedTrack = sanitizeTrack(record.track);
  return {
    id: record.id,
    kind,
    title: optionalString(record.title) || 'Unknown title',
    subtitle: optionalString(record.subtitle) || '',
    thumbnailUrl: optionalString(record.thumbnailUrl) || '',
    browseId: optionalString(record.browseId),
    videoId: optionalString(record.videoId),
    params: optionalString(record.params),
    ...(nestedTrack ? { track: nestedTrack } : {}),
  };
}

function sanitizeBrowseItems(value: unknown): YtMusicBrowseItem[] {
  return Array.isArray(value)
    ? value
        .map((item) => sanitizeBrowseItem(item))
        .filter((item): item is YtMusicBrowseItem => Boolean(item))
    : [];
}

function sanitizeAccount(value: unknown, index: number): YtAccountSummary | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    name: optionalString(record.name) || 'YouTube Music User',
    handle: optionalString(record.handle),
    email: optionalString(record.email),
    avatarUrl: optionalString(record.avatarUrl),
    accountIndex: optionalNumber(record.accountIndex) ?? index,
    visitorData: optionalString(record.visitorData),
    addedAt: optionalNumber(record.addedAt) || Date.now(),
  };
}

function sanitizeUnmatchedTrack(value: unknown): UnmatchedSpotifyTrack | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    name: optionalString(record.name) || 'Unknown track',
    artist: optionalString(record.artist) || 'Unknown artist',
    album: optionalString(record.album) || '',
    durationMs: optionalNumber(record.durationMs) || 0,
    playlistName: optionalString(record.playlistName),
    bestCandidateTitle: optionalString(record.bestCandidateTitle),
    bestCandidateArtist: optionalString(record.bestCandidateArtist),
    bestCandidateScore: optionalNumber(record.bestCandidateScore),
  };
}

function sanitizeSpotifyConnection(value: unknown): SpotifyConnection | null {
  const record = asRecord(value);
  if (!record || typeof record.userId !== 'string' || !record.userId) return null;
  const schedule = record.syncSchedule;
  const syncSchedule =
    schedule === 'DAILY' ||
    schedule === 'WEEKLY' ||
    schedule === 'YEARLY' ||
    schedule === 'MANUAL'
      ? schedule
      : 'MANUAL';
  return {
    userId: record.userId,
    displayName: optionalString(record.displayName) || 'Spotify User',
    email: optionalString(record.email),
    avatarUrl: optionalString(record.avatarUrl),
    loggedIn: optionalBoolean(record.loggedIn) ?? true,
    profileUrl: optionalString(record.profileUrl),
    syncSchedule,
    lastSyncedAt: optionalNumber(record.lastSyncedAt),
    lastSyncedCount: optionalNumber(record.lastSyncedCount),
    unmatchedCount: optionalNumber(record.unmatchedCount),
    unmatchedTracks: Array.isArray(record.unmatchedTracks)
      ? record.unmatchedTracks
          .map((item) => sanitizeUnmatchedTrack(item))
          .filter((item): item is UnmatchedSpotifyTrack => Boolean(item))
      : [],
    lastError: optionalString(record.lastError),
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.KV)) {
        db.createObjectStore(STORES.KV);
      }
      if (!db.objectStoreNames.contains(STORES.LOCAL_BLOBS)) {
        db.createObjectStore(STORES.LOCAL_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => {
        const result = (req.result as T) ?? null;
        db.close();
        resolve(result);
      };
      req.onerror = () => {
        db.close();
        reject(req.error || new Error('IndexedDB read failed'));
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('IndexedDB read transaction failed'));
      };
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value, key);
      req.onerror = () => {
        // The transaction error/abort handler owns the final rejection.
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || req.error || new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB write was aborted'));
    });
  } finally {
    db.close();
  }
}

export interface PersistedLibraryState {
  tracks: Track[];
  playlists: Playlist[];
  tags: PlaylistTag[];
  playEvents: PlayEvent[];
  searchHistory: string[];
  plugins: ArchPlugin[];
  ytAccounts?: YtAccountSummary[];
  activeYtAccountId?: string | null;
  ytSavedAlbums?: YtMusicBrowseItem[];
  ytFollowedArtists?: YtMusicBrowseItem[];
  ytUploadedTracks?: Track[];
  ytHistoryTracks?: Track[];
  lastLibrarySyncAt?: number;
  spotifyConnection?: SpotifyConnection | null;
  ytmLikedTrackIds?: string[];
  localLikedTrackIds?: string[];
}

export interface PersistedQueueState {
  queue: Track[];
  queueIndex: number;
  positionSec: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  savedAt: number;
  /** YouTube Music account that owned the remote entries in this queue. */
  activeYtAccountId?: string | null;
}

export async function saveLocalAudioBlob(trackId: string, blob: Blob): Promise<void> {
  await idbSet(STORES.LOCAL_BLOBS, trackId, blob);
}

export async function loadLocalAudioBlobUrl(trackId: string): Promise<string | null> {
  const blob = await idbGet<Blob>(STORES.LOCAL_BLOBS, trackId);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export async function saveLibraryStateToDb(state: PersistedLibraryState): Promise<void> {
  const write = idbSet(STORES.KV, 'library_state_v3', state).catch(() => undefined);
  pendingLibraryWrites.add(write);
  try {
    await write;
  } finally {
    pendingLibraryWrites.delete(write);
  }
}

export async function waitForPendingLibraryWrites(): Promise<void> {
  await Promise.allSettled(Array.from(pendingLibraryWrites));
}

export async function loadLibraryStateFromDb(): Promise<PersistedLibraryState | null> {
  const state =
    (await idbGet<PersistedLibraryState>(STORES.KV, 'library_state_v3')) ||
    (await idbGet<PersistedLibraryState>(STORES.KV, 'library_state_v2'));
  if (!state) return null;

  // Rehydrate object URLs for locally persisted audio blobs. Every persisted
  // object is rebuilt from an explicit field whitelist so legacy cookies,
  // tokens, and unknown executable-looking fields are never carried forward.
  const sanitizedTracks = sanitizeTracks(state.tracks);
  const hydratedTracks = await Promise.all(
    sanitizedTracks.map(async (track) => {
      if (track.source !== 'local') return track;
      const url = await loadLocalAudioBlobUrl(track.id);
      return url ? { ...track, streamUrl: url } : track;
    }),
  );

  const sanitizedAccounts = Array.isArray(state.ytAccounts)
    ? state.ytAccounts
        .map((account, index) => sanitizeAccount(account, index))
        .filter((account): account is YtAccountSummary => Boolean(account))
    : [];
  const activeYtAccountId =
    typeof state.activeYtAccountId === 'string' && state.activeYtAccountId
      ? state.activeYtAccountId
      : state.activeYtAccountId === null
        ? null
        : undefined;

  return {
    tracks: hydratedTracks,
    playlists: sanitizePlaylists(state.playlists),
    tags: Array.isArray(state.tags)
      ? state.tags
          .map((tag) => sanitizeTag(tag))
          .filter((tag): tag is PlaylistTag => Boolean(tag))
      : [],
    playEvents: Array.isArray(state.playEvents)
      ? state.playEvents
          .map((event) => sanitizePlayEvent(event))
          .filter((event): event is PlayEvent => Boolean(event))
      : [],
    searchHistory: stringArray(state.searchHistory),
    plugins: Array.isArray(state.plugins)
      ? state.plugins
          .map((plugin) => sanitizePlugin(plugin))
          .filter((plugin): plugin is ArchPlugin => Boolean(plugin))
      : [],
    ytAccounts: sanitizedAccounts,
    activeYtAccountId,
    ytSavedAlbums: sanitizeBrowseItems(state.ytSavedAlbums),
    ytFollowedArtists: sanitizeBrowseItems(state.ytFollowedArtists),
    ytUploadedTracks: sanitizeTracks(state.ytUploadedTracks),
    ytHistoryTracks: sanitizeTracks(state.ytHistoryTracks),
    lastLibrarySyncAt: optionalNumber(state.lastLibrarySyncAt),
    spotifyConnection: sanitizeSpotifyConnection(state.spotifyConnection),
    ytmLikedTrackIds: Array.isArray(state.ytmLikedTrackIds)
      ? stringArray(state.ytmLikedTrackIds)
      : undefined,
    localLikedTrackIds: Array.isArray(state.localLikedTrackIds)
      ? stringArray(state.localLikedTrackIds)
      : undefined,
  };
}

export async function saveQueueStateToDb(state: PersistedQueueState): Promise<void> {
  const write = idbSet(STORES.KV, 'queue_state_v1', state).catch(() => undefined);
  pendingLibraryWrites.add(write);
  try {
    await write;
  } finally {
    pendingLibraryWrites.delete(write);
  }
}

export async function loadQueueStateFromDb(): Promise<PersistedQueueState | null> {
  const state = await idbGet<PersistedQueueState>(STORES.KV, 'queue_state_v1');
  if (!state) return null;
  const queue = sanitizeTracks(state.queue);
  if (queue.length === 0) return null;
  const repeatMode =
    state.repeatMode === 'ALL' || state.repeatMode === 'ONE' || state.repeatMode === 'OFF'
      ? state.repeatMode
      : 'OFF';
  const activeYtAccountId =
    typeof state.activeYtAccountId === 'string' && state.activeYtAccountId
      ? state.activeYtAccountId
      : state.activeYtAccountId === null
        ? null
        : undefined;
  return {
    queue,
    queueIndex: Math.max(
      0,
      Math.min(optionalNumber(state.queueIndex) || 0, queue.length - 1),
    ),
    positionSec: optionalNumber(state.positionSec) || 0,
    repeatMode,
    shuffleEnabled: optionalBoolean(state.shuffleEnabled) || false,
    savedAt: optionalNumber(state.savedAt) || Date.now(),
    activeYtAccountId,
  };
}

export async function clearAllLocalDatabase(): Promise<void> {
  await waitForPendingLibraryWrites();
  let clearError: unknown = null;
  try {
    const db = await openDb();
    const storeNames = [STORES.KV, STORES.LOCAL_BLOBS].filter((s) =>
      db.objectStoreNames.contains(s),
    );
    if (storeNames.length > 0) {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeNames, 'readwrite');
          for (const name of storeNames) tx.objectStore(name).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB clear failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB clear was aborted'));
        });
      } finally {
        db.close();
      }
    } else {
      db.close();
    }
    return;
  } catch (err) {
    clearError = err;
  }

  if (typeof indexedDB !== 'undefined') {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error || clearError || new Error('IndexedDB deletion failed'));
      request.onblocked = () =>
        reject(clearError || new Error('IndexedDB deletion was blocked'));
    });
    return;
  }

  throw clearError || new Error('IndexedDB is unavailable.');
}
