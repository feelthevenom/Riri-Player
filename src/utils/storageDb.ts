import {
  ArchPlugin,
  PlayEvent,
  Playlist,
  PlaylistTag,
  RepeatMode,
  SpotifyConnection,
  Track,
  YtAccountSummary,
  YtMusicBrowseItem,
} from '../types/music';

const DB_NAME = 'riri_player_db';
const DB_VERSION = 1;

const STORES = {
  KV: 'kv',
  LOCAL_BLOBS: 'local_blobs',
} as const;

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
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore storage quota / private mode failures
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
}

export interface PersistedQueueState {
  queue: Track[];
  queueIndex: number;
  positionSec: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  savedAt: number;
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
  await idbSet(STORES.KV, 'library_state_v3', state);
}

export async function loadLibraryStateFromDb(): Promise<PersistedLibraryState | null> {
  const state =
    (await idbGet<PersistedLibraryState>(STORES.KV, 'library_state_v3')) ||
    (await idbGet<PersistedLibraryState>(STORES.KV, 'library_state_v2'));
  if (!state) return null;

  // Rehydrate object URLs for locally persisted audio blobs and drop legacy raw cookies/tokens
  const hydratedTracks = await Promise.all(
    (state.tracks || []).map(async (t) => {
      if (t.source === 'local') {
        const url = await loadLocalAudioBlobUrl(t.id);
        if (url) {
          return { ...t, streamUrl: url };
        }
      }
      return t;
    }),
  );

  const sanitizedAccounts: YtAccountSummary[] = Array.isArray(state.ytAccounts)
    ? state.ytAccounts.map((acc, idx) => ({
        id: acc.id,
        name: acc.name,
        handle: acc.handle,
        email: acc.email,
        avatarUrl: acc.avatarUrl,
        accountIndex: typeof acc.accountIndex === 'number' ? acc.accountIndex : idx,
        visitorData: acc.visitorData,
        addedAt: acc.addedAt || Date.now(),
      }))
    : [];

  const sanitizedSpotify: SpotifyConnection | null = state.spotifyConnection
    ? {
        userId: state.spotifyConnection.userId,
        displayName: state.spotifyConnection.displayName,
        email: state.spotifyConnection.email,
        avatarUrl: state.spotifyConnection.avatarUrl,
        loggedIn: Boolean(state.spotifyConnection.loggedIn ?? true),
        profileUrl: state.spotifyConnection.profileUrl,
        syncSchedule: state.spotifyConnection.syncSchedule || 'MANUAL',
        lastSyncedAt: state.spotifyConnection.lastSyncedAt,
        lastSyncedCount: state.spotifyConnection.lastSyncedCount,
        unmatchedCount: state.spotifyConnection.unmatchedCount,
        unmatchedTracks: state.spotifyConnection.unmatchedTracks,
        lastError: state.spotifyConnection.lastError,
      }
    : null;

  return {
    ...state,
    tracks: hydratedTracks,
    ytAccounts: sanitizedAccounts,
    spotifyConnection: sanitizedSpotify,
  };
}

export async function saveQueueStateToDb(state: PersistedQueueState): Promise<void> {
  await idbSet(STORES.KV, 'queue_state_v1', state);
}

export async function loadQueueStateFromDb(): Promise<PersistedQueueState | null> {
  return await idbGet<PersistedQueueState>(STORES.KV, 'queue_state_v1');
}

export async function clearAllLocalDatabase(): Promise<void> {
  try {
    const db = await openDb();
    const storeNames = [STORES.KV, STORES.LOCAL_BLOBS].filter((s) => db.objectStoreNames.contains(s));
    if (storeNames.length > 0) {
      const tx = db.transaction(storeNames, 'readwrite');
      for (const name of storeNames) {
        tx.objectStore(name).clear();
      }
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch {
    // fallback to deleting database
    if (typeof indexedDB !== 'undefined') {
      try {
        indexedDB.deleteDatabase(DB_NAME);
      } catch {
        // ignore
      }
    }
  }
}
