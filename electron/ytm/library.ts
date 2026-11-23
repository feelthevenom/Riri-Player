import type { LibrarySyncProgress, Track, YtMusicBrowseItem } from '../../src/types/music';
import {
  NormalizedYtTrack,
  ParsedYtBrowseCard,
  parseInnertubeBrowseCards,
  parseInnertubeSearchItems,
} from '../../src/utils/ytMusicParser';
import { getActiveYtAccount } from './credentials';
import { innerTubePost } from './innertube';

export interface SyncedYtPlaylistPayload {
  browseId: string;
  playlistId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  tracks: Track[];
}

export interface SyncedYtLibraryResult {
  ok: boolean;
  likedTracks: Track[];
  playlists: SyncedYtPlaylistPayload[];
  savedAlbums: YtMusicBrowseItem[];
  followedArtists: YtMusicBrowseItem[];
  uploadedTracks: Track[];
  historyTracks: Track[];
  syncedAt: number;
  error?: string;
}

function toTrack(t: NormalizedYtTrack, liked = false): Track {
  return {
    ...t,
    source: 'ytmusic',
    liked,
    addedAt: Date.now(),
  };
}

function toBrowseItem(card: ParsedYtBrowseCard): YtMusicBrowseItem {
  return {
    id: card.id,
    kind: card.kind,
    title: card.title,
    subtitle: card.subtitle,
    thumbnailUrl: card.thumbnailUrl,
    browseId: card.browseId,
    videoId: card.videoId,
    params: card.params,
    track: card.track ? toTrack(card.track) : undefined,
  };
}

function extractContinuation(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  let found: string | undefined;
  const walk = (node: unknown, depth = 0) => {
    if (found || !node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (const el of node) walk(el, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.continuation === 'string' && obj.continuation.length > 8) {
      found = obj.continuation;
      return;
    }
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') walk(val, depth + 1);
    }
  };
  walk(json, 0);
  return found;
}

async function browseAllTracks(
  browseId: string,
  gl: string,
  hl: string,
  maxPages = 6,
  liked = false,
): Promise<Track[]> {
  const collected: Track[] = [];
  const seen = new Set<string>();

  const firstJson = await innerTubePost({
    endpoint: 'browse',
    body: { browseId },
    gl,
    hl,
  });

  for (const t of parseInnertubeSearchItems(firstJson)) {
    if (!seen.has(t.ytMusicVideoId)) {
      seen.add(t.ytMusicVideoId);
      collected.push(toTrack(t, liked));
    }
  }

  let continuation = extractContinuation(firstJson);
  let page = 1;
  while (continuation && page < maxPages) {
    const nextJson = await innerTubePost({
      endpoint: 'browse',
      body: { continuation },
      gl,
      hl,
    }).catch(() => null);
    if (!nextJson) break;
    const nextTracks = parseInnertubeSearchItems(nextJson);
    if (nextTracks.length === 0) break;
    for (const t of nextTracks) {
      if (!seen.has(t.ytMusicVideoId)) {
        seen.add(t.ytMusicVideoId);
        collected.push(toTrack(t, liked));
      }
    }
    const nextCont = extractContinuation(nextJson);
    if (!nextCont || nextCont === continuation) break;
    continuation = nextCont;
    page += 1;
  }

  return collected;
}

async function browseAllCards(
  browseId: string,
  fallbackKind: ParsedYtBrowseCard['kind'],
  gl: string,
  hl: string,
  maxPages = 4,
): Promise<ParsedYtBrowseCard[]> {
  const collected: ParsedYtBrowseCard[] = [];
  const seen = new Set<string>();

  const firstJson = await innerTubePost({
    endpoint: 'browse',
    body: { browseId },
    gl,
    hl,
  });

  for (const c of parseInnertubeBrowseCards(firstJson, fallbackKind)) {
    const key = c.browseId || c.id;
    if (!seen.has(key)) {
      seen.add(key);
      collected.push(c);
    }
  }

  let continuation = extractContinuation(firstJson);
  let page = 1;
  while (continuation && page < maxPages) {
    const nextJson = await innerTubePost({
      endpoint: 'browse',
      body: { continuation },
      gl,
      hl,
    }).catch(() => null);
    if (!nextJson) break;
    const nextCards = parseInnertubeBrowseCards(nextJson, fallbackKind);
    if (nextCards.length === 0) break;
    for (const c of nextCards) {
      const key = c.browseId || c.id;
      if (!seen.has(key)) {
        seen.add(key);
        collected.push(c);
      }
    }
    const nextCont = extractContinuation(nextJson);
    if (!nextCont || nextCont === continuation) break;
    continuation = nextCont;
    page += 1;
  }

  return collected;
}

/**
 * Phase 3: ArchiveTune SyncUtils-style incremental library sync.
 */
export async function syncYtmLibrary(opts: {
  gl?: string;
  hl?: string;
  onProgress?: (progress: LibrarySyncProgress) => void;
}): Promise<SyncedYtLibraryResult> {
  const active = await getActiveYtAccount();
  if (!active) {
    return {
      ok: false,
      likedTracks: [],
      playlists: [],
      savedAlbums: [],
      followedArtists: [],
      uploadedTracks: [],
      historyTracks: [],
      syncedAt: Date.now(),
      error: 'Sign in to YouTube Music to sync your library.',
    };
  }

  const gl = (opts.gl || 'US').toUpperCase();
  const hl = opts.hl || 'en';
  const totalSteps = 6;
  const emit = (phase: string, completed: number, message: string, inProgress = true) => {
    opts.onProgress?.({
      phase,
      completed,
      total: totalSteps,
      message,
      inProgress,
    });
  };

  try {
    emit('liked', 0, 'Syncing Liked Songs...');
    let likedTracks = await browseAllTracks('VLLM', gl, hl, 8, true).catch(() => [] as Track[]);
    if (likedTracks.length === 0) {
      likedTracks = await browseAllTracks('FEmusic_liked_videos', gl, hl, 6, true).catch(
        () => [] as Track[],
      );
    }

    emit('playlists', 1, 'Syncing Playlists...');
    const [likedPlCards, corpusPlCards] = await Promise.all([
      browseAllCards('FEmusic_liked_playlists', 'playlist', gl, hl, 4).catch(
        () => [] as ParsedYtBrowseCard[],
      ),
      browseAllCards('FEmusic_library_corpus_playlists', 'playlist', gl, hl, 4).catch(
        () => [] as ParsedYtBrowseCard[],
      ),
    ]);

    const playlistCardsMap = new Map<string, ParsedYtBrowseCard>();
    for (const c of [...likedPlCards, ...corpusPlCards]) {
      const bid = c.browseId || '';
      if (!bid) continue;
      const cleanId = bid.startsWith('VL') ? bid.slice(2) : bid;
      // ArchiveTune SyncUtils: skip LM (Liked Music) and SE (Episodes for Later)
      if (cleanId === 'LM' || cleanId === 'SE' || bid === 'VLLM' || bid === 'VLSE') continue;
      if (!playlistCardsMap.has(bid)) {
        playlistCardsMap.set(bid, c);
      }
    }

    const playlists: SyncedYtPlaylistPayload[] = [];
    const plEntries = Array.from(playlistCardsMap.values()).slice(0, 32);
    for (const plCard of plEntries) {
      const browseId = plCard.browseId!;
      const plTracks = await browseAllTracks(browseId, gl, hl, 5, false).catch(() => [] as Track[]);
      playlists.push({
        browseId,
        playlistId: browseId.startsWith('VL') ? browseId.slice(2) : browseId,
        title: plCard.title,
        subtitle: plCard.subtitle,
        thumbnailUrl: plCard.thumbnailUrl,
        tracks: plTracks,
      });
    }

    emit('albums', 2, 'Syncing Saved Albums...');
    const albumCards = await browseAllCards('FEmusic_liked_albums', 'album', gl, hl, 4).catch(
      () => [] as ParsedYtBrowseCard[],
    );
    const savedAlbums = albumCards.map(toBrowseItem);

    emit('artists', 3, 'Syncing Followed Artists...');
    const artistCards = await browseAllCards(
      'FEmusic_library_corpus_artists',
      'artist',
      gl,
      hl,
      4,
    ).catch(() => [] as ParsedYtBrowseCard[]);
    const followedArtists = artistCards.map(toBrowseItem);

    emit('uploads', 4, 'Syncing Uploads...');
    const uploadedTracks = await browseAllTracks(
      'FEmusic_library_privately_owned_tracks',
      gl,
      hl,
      4,
      false,
    ).catch(() => [] as Track[]);

    emit('history', 5, 'Syncing Listening History...');
    const historyTracks = await browseAllTracks('FEmusic_history', gl, hl, 2, false).catch(
      () => [] as Track[],
    );

    const syncedAt = Date.now();
    opts.onProgress?.({
      phase: 'done',
      completed: totalSteps,
      total: totalSteps,
      message: `Synced ${likedTracks.length} liked songs & ${playlists.length} playlists`,
      inProgress: false,
      lastSyncedAt: syncedAt,
    });

    return {
      ok: true,
      likedTracks,
      playlists,
      savedAlbums,
      followedArtists,
      uploadedTracks,
      historyTracks,
      syncedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Library sync failed.';
    opts.onProgress?.({
      phase: 'error',
      completed: 0,
      total: totalSteps,
      message,
      inProgress: false,
    });
    return {
      ok: false,
      likedTracks: [],
      playlists: [],
      savedAlbums: [],
      followedArtists: [],
      uploadedTracks: [],
      historyTracks: [],
      syncedAt: Date.now(),
      error: message,
    };
  }
}

export async function setYtmLikeStatus(opts: {
  videoId: string;
  liked: boolean;
  gl?: string;
  hl?: string;
}): Promise<{ ok: boolean }> {
  const active = await getActiveYtAccount();
  if (!active || !opts.videoId) return { ok: false };
  try {
    await innerTubePost({
      endpoint: opts.liked ? 'like/like' : 'like/removelike',
      body: {
        target: { videoId: opts.videoId },
      },
      gl: opts.gl || 'US',
      hl: opts.hl || 'en',
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
