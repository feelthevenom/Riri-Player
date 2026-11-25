import type { LibrarySyncProgress, Track, YtMusicBrowseItem } from '../../src/types/music';
import {
  NormalizedYtTrack,
  ParsedYtBrowseCard,
  parseInnertubeBrowseCards,
  parseInnertubeSearchItems,
} from '../../src/utils/ytMusicParser';
import { extractYtMusicContinuation } from '../../src/utils/ytmContinuation';
import { getActiveYtAccount, type StoredYtAccount } from './credentials';
import { hasYouTubeLoginCookie } from './clients';
import { innerTubePost } from './innertube';

export interface SyncedYtPlaylistPayload {
  browseId: string;
  playlistId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  tracks: Track[];
  /**
   * True when `tracks` is the playlist's complete membership. A false value
   * means the list is a partial snapshot and must not replace a previously
   * known complete membership.
   */
  tracksComplete: boolean;
  /** Diagnostic reason for an incomplete `tracks` list. */
  tracksIncompleteReason?: string;
}

export interface SyncedYtLibraryResult {
  ok: boolean;
  likedTracks: Track[];
  libraryTracks: Track[];
  playlists: SyncedYtPlaylistPayload[];
  savedAlbums: YtMusicBrowseItem[];
  followedArtists: YtMusicBrowseItem[];
  uploadedTracks: Track[];
  historyTracks: Track[];
  /** True only when every requested collection was fetched to completion. */
  complete: boolean;
  /**
   * True when the remote playlist manifest itself was fetched to completion.
   * Remote playlists may be pruned only when this is true.
   */
  playlistsComplete: boolean;
  /** Diagnostic reason when one or more collections hit a safety limit. */
  incompleteReason?: string;
  syncedAt: number;
  accountId?: string | null;
  error?: string;
}

export interface YtmPaginationResult<T> {
  items: T[];
  complete: boolean;
  incompleteReason?: string;
}

/**
 * A pagination safety limit is distinct from an authentication or transport
 * failure. The caller receives the partial items together with an explicit
 * `complete: false` signal instead of treating the data as a full snapshot.
 */
export class YtmPaginationSafetyLimitError<T = unknown> extends Error {
  readonly code = 'YTM_PAGINATION_SAFETY_LIMIT';
  readonly complete = false;
  readonly partialItems: T[];

  constructor(message: string, partialItems: T[]) {
    super(message);
    this.name = 'YtmPaginationSafetyLimitError';
    this.partialItems = partialItems;
  }
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

// The hard bound only exists to stop a malformed continuation chain. Normal
// libraries are followed until InnerTube stops returning a continuation. The
// effective bound grows with the amount of data already collected so large
// libraries are not mistaken for truncated ones.
const PAGINATION_HARD_PAGE_LIMIT = 512;
const PAGINATION_MIN_DYNAMIC_PAGES = 64;
const PAGINATION_ITEMS_PER_PAGE_ESTIMATE = 20;
const PAGINATION_PAGE_MULTIPLIER = 4;

function getPaginationSafetyLimit(itemCount: number, hardLimit: number): number {
  const normalizedHardLimit = Math.max(1, Math.floor(hardLimit));
  const estimatedPages = Math.ceil(itemCount / PAGINATION_ITEMS_PER_PAGE_ESTIMATE);
  const dynamicLimit = Math.max(
    PAGINATION_MIN_DYNAMIC_PAGES,
    estimatedPages * PAGINATION_PAGE_MULTIPLIER,
  );
  return Math.min(normalizedHardLimit, dynamicLimit);
}

async function browseAllPages<T>(opts: {
  browseId: string;
  gl: string;
  hl: string;
  account: StoredYtAccount;
  maxPages?: number;
  request?: typeof innerTubePost;
  parsePage: (json: unknown) => T[];
  getKey: (item: T) => string;
}): Promise<YtmPaginationResult<T>> {
  const {
    browseId,
    gl,
    hl,
    account,
    parsePage,
    getKey,
  } = opts;
  const request = opts.request || innerTubePost;
  const hardLimit = opts.maxPages ?? PAGINATION_HARD_PAGE_LIMIT;
  const collected: T[] = [];
  const seen = new Set<string>();
  const seenContinuations = new Set<string>();

  const firstJson = await request({
    endpoint: 'browse',
    body: { browseId },
    gl,
    hl,
    requireAuth: true,
    accountOverride: account,
  });
  if (!firstJson) {
    throw new Error(
      `YouTube Music pagination for ${browseId} returned no response; sync failed.`,
    );
  }

  for (const item of parsePage(firstJson)) {
    const key = getKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      collected.push(item);
    }
  }

  let continuation = extractYtMusicContinuation(firstJson, { itemShelfOnly: true });
  let page = 1;
  while (continuation) {
    if (seenContinuations.has(continuation)) {
      throw new Error(
        `YouTube Music pagination for ${browseId} repeated a continuation token; sync was not treated as complete.`,
      );
    }

    const safetyLimit = getPaginationSafetyLimit(collected.length, hardLimit);
    if (page >= safetyLimit) {
      return {
        items: collected,
        complete: false,
        incompleteReason:
          `YouTube Music pagination for ${browseId} reached the safety limit of ` +
          `${safetyLimit} pages; the result is incomplete.`,
      };
    }

    seenContinuations.add(continuation);
    const nextJson = await request({
      endpoint: 'browse',
      body: { continuation },
      gl,
      hl,
      requireAuth: true,
      accountOverride: account,
    });
    if (!nextJson) {
      throw new Error(
        `YouTube Music pagination for ${browseId} returned no response; sync failed.`,
      );
    }

    for (const item of parsePage(nextJson)) {
      const key = getKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        collected.push(item);
      }
    }

    const nextContinuation = extractYtMusicContinuation(nextJson, {
      itemShelfOnly: true,
    });
    if (!nextContinuation) break;
    if (nextContinuation === continuation) {
      throw new Error(
        `YouTube Music pagination for ${browseId} repeated a continuation token; sync was not treated as complete.`,
      );
    }

    // An empty parsed page is not proof that pagination ended. Follow the
    // continuation so a parser gap cannot silently truncate the library.
    continuation = nextContinuation;
    page += 1;
  }

  return { items: collected, complete: true };
}

export async function browseAllTracksWithStatus(
  browseId: string,
  gl: string,
  hl: string,
  account: StoredYtAccount,
  maxPages = PAGINATION_HARD_PAGE_LIMIT,
  liked = false,
  request: typeof innerTubePost = innerTubePost,
): Promise<YtmPaginationResult<Track>> {
  return await browseAllPages({
    browseId,
    gl,
    hl,
    account,
    maxPages,
    request,
    parsePage: (json) =>
      parseInnertubeSearchItems(json).map((track) => toTrack(track, liked)),
    getKey: (track) => track.ytMusicVideoId || track.id,
  });
}

/**
 * Backward-compatible track helper. New sync code uses the status-returning
 * variant so a safety-limited result can be surfaced as an explicit partial
 * snapshot instead of an authentication/network failure.
 */
export async function browseAllTracks(
  browseId: string,
  gl: string,
  hl: string,
  account: StoredYtAccount,
  maxPages = PAGINATION_HARD_PAGE_LIMIT,
  liked = false,
  request: typeof innerTubePost = innerTubePost,
): Promise<Track[]> {
  const result = await browseAllTracksWithStatus(
    browseId,
    gl,
    hl,
    account,
    maxPages,
    liked,
    request,
  );
  if (!result.complete) {
    throw new YtmPaginationSafetyLimitError(
      result.incompleteReason || 'YouTube Music pagination was incomplete.',
      result.items,
    );
  }
  return result.items;
}

export async function browseAllCardsWithStatus(
  browseId: string,
  fallbackKind: ParsedYtBrowseCard['kind'],
  gl: string,
  hl: string,
  account: StoredYtAccount,
  maxPages = PAGINATION_HARD_PAGE_LIMIT,
  request: typeof innerTubePost = innerTubePost,
): Promise<YtmPaginationResult<ParsedYtBrowseCard>> {
  return await browseAllPages({
    browseId,
    gl,
    hl,
    account,
    maxPages,
    request,
    parsePage: (json) => parseInnertubeBrowseCards(json, fallbackKind),
    getKey: (card) => card.browseId || card.id,
  });
}

/**
 * Phase 3: ArchiveTune SyncUtils-style incremental library sync.
 */
export async function performYtmLibrarySync(opts: {
  account: StoredYtAccount | null;
  gl?: string;
  hl?: string;
  onProgress?: (progress: LibrarySyncProgress) => void;
  /** Test seam; production syncs use the real InnerTube client. */
  request?: typeof innerTubePost;
  /** Test seam for exercising the pagination safety boundary. */
  paginationMaxPages?: number;
}): Promise<SyncedYtLibraryResult> {
  console.log('[YTM Auth] Starting YouTube Music library sync...');
  const active = opts.account;
  if (!active || !hasYouTubeLoginCookie(active.cookie)) {
    return {
      ok: false,
      likedTracks: [],
      libraryTracks: [],
      playlists: [],
      savedAlbums: [],
      followedArtists: [],
      uploadedTracks: [],
      historyTracks: [],
      complete: false,
      playlistsComplete: false,
      syncedAt: Date.now(),
      accountId: active?.id || null,
      error: 'Sign in to YouTube Music to sync your library.',
    };
  }

  const gl = (opts.gl || 'US').toUpperCase();
  const hl = opts.hl || 'en';
  const request = opts.request || innerTubePost;
  const maxPages = opts.paginationMaxPages;
  const totalSteps = 6;
  const incompleteReasons: string[] = [];
  const emit = (phase: string, completed: number, message: string, inProgress = true) => {
    opts.onProgress?.({
      phase,
      completed,
      total: totalSteps,
      message,
      inProgress,
    });
  };
  const recordIncomplete = (
    result: YtmPaginationResult<unknown>,
    label: string,
  ): void => {
    if (result.complete) return;
    incompleteReasons.push(
      `${label}: ${result.incompleteReason || 'pagination safety limit reached'}`,
    );
  };

  try {
    emit('liked', 0, 'Syncing Liked Songs...');
    // VLLM is the Liked Songs collection. FEmusic_liked_videos is the
    // separate saved-library collection and must be synced as well; treating
    // it only as a fallback causes newly added library songs to be missed.
    const likedResult = await browseAllTracksWithStatus(
      'VLLM',
      gl,
      hl,
      active,
      maxPages,
      true,
      request,
    );
    recordIncomplete(likedResult, 'Liked songs');

    const libraryResult = await browseAllTracksWithStatus(
      'FEmusic_liked_videos',
      gl,
      hl,
      active,
      maxPages,
      false,
      request,
    );
    recordIncomplete(libraryResult, 'Library songs');

    emit('playlists', 1, 'Syncing Playlists...');
    // FEmusic_library_corpus_playlists was removed by YouTube Music and now
    // returns HTTP 400. FEmusic_liked_playlists is the current library
    // endpoint and contains the account's created/saved playlists.
    const playlistManifest = await browseAllCardsWithStatus(
      'FEmusic_liked_playlists',
      'playlist',
      gl,
      hl,
      active,
      maxPages,
      request,
    );
    recordIncomplete(playlistManifest, 'Playlist manifest');

    const playlistCardsMap = new Map<string, ParsedYtBrowseCard>();
    for (const c of playlistManifest.items) {
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
    // Follow the entire remote manifest. The old 32-entry slice silently
    // discarded playlists and made a partial manifest look authoritative.
    const plEntries = Array.from(playlistCardsMap.values());
    for (const plCard of plEntries) {
      const browseId = plCard.browseId!;
      const plTrackResult = await browseAllTracksWithStatus(
        browseId,
        gl,
        hl,
        active,
        maxPages,
        false,
        request,
      );
      recordIncomplete(plTrackResult, `Playlist ${browseId} tracks`);
      playlists.push({
        browseId,
        playlistId: browseId.startsWith('VL') ? browseId.slice(2) : browseId,
        title: plCard.title,
        subtitle: plCard.subtitle,
        thumbnailUrl: plCard.thumbnailUrl,
        tracks: plTrackResult.items,
        tracksComplete: plTrackResult.complete,
        tracksIncompleteReason: plTrackResult.incompleteReason,
      });
    }

    emit('albums', 2, 'Syncing Saved Albums...');
    const albumResult = await browseAllCardsWithStatus(
      'FEmusic_liked_albums',
      'album',
      gl,
      hl,
      active,
      maxPages,
      request,
    );
    recordIncomplete(albumResult, 'Saved albums');
    const savedAlbums = albumResult.items.map(toBrowseItem);

    emit('artists', 3, 'Syncing Followed Artists...');
    const artistResult = await browseAllCardsWithStatus(
      'FEmusic_library_corpus_artists',
      'artist',
      gl,
      hl,
      active,
      maxPages,
      request,
    );
    recordIncomplete(artistResult, 'Followed artists');
    const followedArtists = artistResult.items.map(toBrowseItem);

    emit('uploads', 4, 'Syncing Uploads...');
    const uploadedResult = await browseAllTracksWithStatus(
      'FEmusic_library_privately_owned_tracks',
      gl,
      hl,
      active,
      maxPages,
      false,
      request,
    );
    recordIncomplete(uploadedResult, 'Uploads');

    emit('history', 5, 'Syncing Listening History...');
    const historyResult = await browseAllTracksWithStatus(
      'FEmusic_history',
      gl,
      hl,
      active,
      maxPages,
      false,
      request,
    );
    recordIncomplete(historyResult, 'History');

    const complete = incompleteReasons.length === 0;
    const syncedAt = Date.now();
    const incompleteReason = incompleteReasons.length
      ? incompleteReasons.join(' ')
      : undefined;
    opts.onProgress?.({
      phase: complete ? 'done' : 'error',
      completed: totalSteps,
      total: totalSteps,
      message: complete
        ? `Synced ${likedResult.items.length} liked songs, ` +
          `${libraryResult.items.length} library songs & ` +
          `${playlists.length} playlists`
        : `Library sync was incomplete: ${incompleteReason}`,
      inProgress: false,
      lastSyncedAt: complete ? syncedAt : undefined,
    });

    return {
      // A safety-limited pagination result is diagnostic data, never a
      // successful partial sync. Callers must not apply this snapshot.
      ok: complete,
      likedTracks: likedResult.items,
      libraryTracks: libraryResult.items,
      playlists,
      savedAlbums,
      followedArtists,
      uploadedTracks: uploadedResult.items,
      historyTracks: historyResult.items,
      complete,
      playlistsComplete: playlistManifest.complete,
      incompleteReason,
      syncedAt,
      accountId: active.id,
      error: complete ? undefined : incompleteReason,
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
    // A request failure invalidates the whole snapshot. Never return the
    // successfully fetched prefix as a partial-success sync.
    return {
      ok: false,
      likedTracks: [],
      libraryTracks: [],
      playlists: [],
      savedAlbums: [],
      followedArtists: [],
      uploadedTracks: [],
      historyTracks: [],
      complete: false,
      playlistsComplete: false,
      syncedAt: Date.now(),
      accountId: active?.id || null,
      error: message,
    };
  }
}

const activeLibrarySyncs = new Map<string, Promise<SyncedYtLibraryResult>>();

/**
 * Coalesces repeated Sync clicks for the same account while allowing a
 * different account to start its own request. Every request uses one account
 * snapshot, so a mid-sync account switch cannot mix two libraries.
 */
export async function syncYtmLibrary(opts: {
  gl?: string;
  hl?: string;
  onProgress?: (progress: LibrarySyncProgress) => void;
}): Promise<SyncedYtLibraryResult> {
  const account = await getActiveYtAccount();
  if (!account) {
    return await performYtmLibrarySync({ ...opts, account: null });
  }

  const existing = activeLibrarySyncs.get(account.id);
  if (existing) return await existing;

  const request = performYtmLibrarySync({ ...opts, account });
  activeLibrarySyncs.set(account.id, request);
  void request.then(
    () => {
      if (activeLibrarySyncs.get(account.id) === request) {
        activeLibrarySyncs.delete(account.id);
      }
    },
    () => {
      if (activeLibrarySyncs.get(account.id) === request) {
        activeLibrarySyncs.delete(account.id);
      }
    },
  );
  return await request;
}

export async function setYtmLikeStatus(opts: {
  videoId: string;
  liked: boolean;
  gl?: string;
  hl?: string;
  expectedAccountId?: string | null;
}): Promise<{ ok: boolean }> {
  const active = await getActiveYtAccount();
  if (
    !active ||
    !opts.videoId ||
    (opts.expectedAccountId && opts.expectedAccountId !== active.id)
  ) {
    return { ok: false };
  }
  try {
    await innerTubePost({
      endpoint: opts.liked ? 'like/like' : 'like/removelike',
      body: {
        target: { videoId: opts.videoId },
      },
      gl: opts.gl || 'US',
      hl: opts.hl || 'en',
      requireAuth: true,
      accountOverride: active,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
