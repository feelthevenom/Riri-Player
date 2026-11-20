import {
  ArchPlugin,
  PlayEvent,
  Playlist,
  PlaylistTag,
  SpotifyConnection,
  Track,
  YtMusicAccount,
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
  ytAccounts?: YtMusicAccount[];
  activeYtAccountId?: string | null;
  ytSavedAlbums?: YtMusicBrowseItem[];
  ytFollowedArtists?: YtMusicBrowseItem[];
  ytUploadedTracks?: Track[];
  spotifyConnection?: SpotifyConnection | null;
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
  await idbSet(STORES.KV, 'library_state_v2', state);
}

export async function loadLibraryStateFromDb(): Promise<PersistedLibraryState | null> {
  const state = await idbGet<PersistedLibraryState>(STORES.KV, 'library_state_v2');
  if (!state) return null;

  // Rehydrate object URLs for locally persisted audio blobs
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

  return {
    ...state,
    tracks: hydratedTracks,
  };
}
