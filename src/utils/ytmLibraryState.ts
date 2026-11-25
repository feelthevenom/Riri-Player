import type { Playlist, Track } from '../types/music';

export interface LikedTrackSets {
  ytmLikedIds: string[];
  localLikedIds: string[];
}

export interface DeriveLikedTrackSetsInput {
  persistedLikedIds?: Iterable<string>;
  persistedYtmLikedIds?: Iterable<string>;
  persistedLocalLikedIds?: Iterable<string>;
  tracks?: Track[];
  playlists?: Playlist[];
}

function uniqueIds(ids: Iterable<string> | undefined): string[] {
  if (!ids) return [];
  return Array.from(new Set(Array.from(ids).filter(Boolean)));
}

/**
 * Merges the authoritative YouTube Music liked set with the independent
 * local/Spotify liked set. Neither source may erase the other.
 */
export function mergeLikedTrackIds(
  remoteLikedIds: Iterable<string>,
  localLikedIds: Iterable<string>,
): string[] {
  return Array.from(new Set([...remoteLikedIds, ...localLikedIds]));
}

export function applyLikedTrackIdsToTracks(
  tracks: Track[],
  likedTrackIds: Iterable<string>,
): Track[] {
  const liked = new Set(likedTrackIds);
  return tracks.map((track) => ({
    ...track,
    liked: liked.has(track.id),
  }));
}

/**
 * Collects tracks that are owned by independent user state rather than by a
 * YouTube Music account: local/Spotify playlists and local likes. These
 * tracks remain usable after an account switch even when their remote cache
 * entry came from YouTube Music.
 */
export function collectIndependentYtTrackIds(
  playlists: Playlist[] | undefined,
  localLikedIds?: Iterable<string>,
): Set<string> {
  const retained = new Set<string>();
  for (const id of localLikedIds || []) {
    if (id) retained.add(id);
  }
  for (const playlist of playlists || []) {
    // `pl-liked` is the aggregate of remote and independent likes, so it
    // cannot prove that every member belongs to independent user state.
    if (playlist.id === 'pl-liked' || playlist.ytBrowseId) continue;
    for (const trackId of playlist.trackIds || []) {
      if (trackId) retained.add(trackId);
    }
  }
  return retained;
}

/**
 * Assigns untagged YouTube Music cache entries to a trusted persisted account.
 * This is used only when the persisted snapshot's account id matches the
 * authoritative vault account. Independently owned tracks remain untagged.
 */
export function tagYtMusicTracksForAccount(
  tracks: Track[],
  accountId: string,
  independentTrackIds?: Iterable<string>,
): Track[] {
  const independent = new Set(independentTrackIds || []);
  return tracks.map((track) => {
    if (
      track.source !== 'ytmusic' ||
      track.ytAccountId ||
      independent.has(track.id)
    ) {
      return track;
    }
    return { ...track, ytAccountId: accountId };
  });
}

/** Remote state is restorable only when both sides name the same account. */
export function isPersistedYtAccountMatch(
  activeAccountId: string | null | undefined,
  persistedAccountId: string | null | undefined,
): boolean {
  return Boolean(
    activeAccountId &&
      persistedAccountId &&
      activeAccountId === persistedAccountId,
  );
}

/**
 * Determines whether a persisted queue may restore remote entries. New queue
 * snapshots carry their owner directly; legacy queues may inherit the owner
 * of the matching persisted library snapshot.
 */
export function isPersistedYtQueueOwnedByAccount(
  activeAccountId: string | null | undefined,
  queueOwnerId: string | null | undefined,
  libraryOwnerId: string | null | undefined,
): boolean {
  if (!activeAccountId) return false;
  if (queueOwnerId) return queueOwnerId === activeAccountId;
  return Boolean(libraryOwnerId && libraryOwnerId === activeAccountId);
}

/**
 * Keeps only remote tracks owned by the selected YouTube Music account.
 * Legacy untagged remote tracks are discarded because their account cannot be
 * proven, unless independent local/Spotify state still references them.
 */
export function scopeYtMusicTracksToAccount(
  tracks: Track[],
  accountId: string | null | undefined,
  independentTrackIds?: Iterable<string>,
): Track[] {
  const independent = new Set(independentTrackIds || []);
  return tracks.flatMap((track) => {
    if (track.source !== 'ytmusic') return [track];
    if (track.ytAccountId) {
      if (track.ytAccountId === accountId) return [track];
      if (independent.has(track.id)) {
        const independentTrack = { ...track };
        delete independentTrack.ytAccountId;
        return [independentTrack];
      }
      return [];
    }
    return independent.has(track.id) ? [track] : [];
  });
}

/**
 * A library snapshot is authoritative only when the main process explicitly
 * confirms that every requested collection completed. Missing legacy flags
 * must not be interpreted as permission to overwrite known-good state.
 */
export function isAuthoritativeYtLibrarySnapshot(snapshot: {
  ok?: boolean;
  complete?: boolean;
}): boolean {
  return snapshot.ok === true && snapshot.complete === true;
}

/** Remote cloud playlists may be pruned only from a complete manifest. */
export function canPruneYtPlaylistManifest(playlistsComplete?: boolean): boolean {
  return playlistsComplete === true;
}

/** Existing playlist membership may be replaced only by a complete list. */
export function canReplaceYtPlaylistTracks(tracksComplete?: boolean): boolean {
  return tracksComplete === true;
}

export interface SyncedYtPlaylistMembership {
  browseId: string;
  playlistId?: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  tracks?: Array<{ id: string; thumbnailUrl?: string }>;
  tracksComplete?: boolean;
}

/**
 * Merges a YouTube Music playlist snapshot without allowing incomplete remote
 * data to erase known-good playlist metadata or membership.
 */
export function mergeSyncedYtPlaylists(
  existing: Playlist[],
  remote: SyncedYtPlaylistMembership[],
  playlistsComplete?: boolean,
): Playlist[] {
  const incomingBrowseIds = new Set(remote.map((playlist) => playlist.browseId));
  let next = canPruneYtPlaylistManifest(playlistsComplete)
    ? existing.filter(
        (playlist) => !playlist.ytBrowseId || incomingBrowseIds.has(playlist.ytBrowseId),
      )
    : [...existing];

  for (const synced of remote) {
    const id = `ytpl-${synced.browseId}`;
    const trackIds = (synced.tracks || []).map((track) => track.id);
    const tracksComplete = canReplaceYtPlaylistTracks(synced.tracksComplete);
    const current = next.find((playlist) => playlist.id === id);

    if (current) {
      next = next.map((playlist) =>
        playlist.id === id
          ? {
              ...playlist,
              name: synced.title || playlist.name,
              description: synced.subtitle || playlist.description,
              coverUrl: synced.thumbnailUrl || playlist.coverUrl,
              trackIds: tracksComplete ? trackIds : playlist.trackIds,
              ytBrowseId: synced.browseId,
              ytPlaylistId: synced.playlistId,
            }
          : playlist,
      );
      continue;
    }

    next = [
      ...next,
      {
        id,
        name: synced.title || 'YouTube Music Playlist',
        description: synced.subtitle || 'Synced from YouTube Music',
        trackIds: tracksComplete ? trackIds : [],
        tagIds: [],
        coverUrl: synced.thumbnailUrl || synced.tracks?.[0]?.thumbnailUrl,
        createdAt: Date.now(),
        ytBrowseId: synced.browseId,
        ytPlaylistId: synced.playlistId,
      },
    ];
  }

  return next;
}

/**
 * Restores the two independent liked sets from persisted state.
 *
 * Older builds only stored their union in `pl-liked`. For those snapshots,
 * local/plugin tracks and tracks owned by a Spotify playlist are treated as
 * local likes; other YouTube Music tracks are treated as remote likes. This
 * keeps the first authoritative YTM sync from erasing local favorites while
 * still allowing remotely unliked YTM tracks to disappear.
 */
export function deriveLikedTrackSets(input: DeriveLikedTrackSetsInput): LikedTrackSets {
  const aggregate = uniqueIds(input.persistedLikedIds);
  const hasRemote = input.persistedYtmLikedIds !== undefined;
  const hasLocal = input.persistedLocalLikedIds !== undefined;

  if (hasRemote && hasLocal) {
    return {
      ytmLikedIds: uniqueIds(input.persistedYtmLikedIds),
      localLikedIds: uniqueIds(input.persistedLocalLikedIds),
    };
  }

  if (hasRemote) {
    const remote = uniqueIds(input.persistedYtmLikedIds);
    const remoteSet = new Set(remote);
    return {
      ytmLikedIds: remote,
      localLikedIds: aggregate.filter((trackId) => !remoteSet.has(trackId)),
    };
  }

  if (hasLocal) {
    const local = uniqueIds(input.persistedLocalLikedIds);
    // Without an explicit remote set, the remainder of the aggregate cannot be
    // proven to be a YouTube Music like. Keep the independent local set and
    // wait for the next authoritative remote snapshot.
    return {
      ytmLikedIds: [],
      localLikedIds: local,
    };
  }

  const tracks = input.tracks || [];
  const playlists = input.playlists || [];
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const spotifyTrackIds = new Set<string>();
  for (const playlist of playlists) {
    if (!playlist.spotifyId) continue;
    for (const trackId of playlist.trackIds) spotifyTrackIds.add(trackId);
  }

  const local = aggregate.filter((trackId) => {
    const track = trackById.get(trackId);
    return Boolean(track && track.source !== 'ytmusic') || spotifyTrackIds.has(trackId);
  });
  const localSet = new Set(local);
  const remote = aggregate.filter((trackId) => !localSet.has(trackId));

  return {
    ytmLikedIds: remote,
    localLikedIds: local,
  };
}
