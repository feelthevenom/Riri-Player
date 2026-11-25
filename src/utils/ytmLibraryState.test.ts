import assert from 'node:assert/strict';
import test from 'node:test';
import type { Playlist, Track } from '../types/music';
import {
  applyLikedTrackIdsToTracks,
  canPruneYtPlaylistManifest,
  collectIndependentYtTrackIds,
  canReplaceYtPlaylistTracks,
  deriveLikedTrackSets,
  isAuthoritativeYtLibrarySnapshot,
  isPersistedYtAccountMatch,
  isPersistedYtQueueOwnedByAccount,
  mergeLikedTrackIds,
  mergeSyncedYtPlaylists,
  scopeYtMusicTracksToAccount,
  tagYtMusicTracksForAccount,
} from './ytmLibraryState';

function track(id: string, source: Track['source'] = 'ytmusic'): Track {
  return {
    id,
    title: id,
    artist: 'Artist',
    album: 'Album',
    durationSec: 180,
    thumbnailUrl: '',
    streamUrl: '',
    source,
  };
}

test('liked state keeps authoritative YTM and independent local likes', () => {
  assert.deepEqual(mergeLikedTrackIds(['ytm-1', 'shared'], ['local-1', 'shared']), [
    'ytm-1',
    'shared',
    'local-1',
  ]);

  const tracks = [track('ytm-1'), track('local-1')];
  assert.deepEqual(
    applyLikedTrackIdsToTracks(tracks, ['ytm-1', 'local-1']).map((item) => item.liked),
    [true, true],
  );
  assert.deepEqual(
    applyLikedTrackIdsToTracks(tracks, ['ytm-1']).map((item) => item.liked),
    [true, false],
  );
});

test('legacy liked state migrates local, Spotify, and YTM likes separately', () => {
  const tracks = [track('ytm-1'), track('ytm-2'), track('local-1', 'local')];
  const playlists: Playlist[] = [
    {
      id: 'sp-playlist',
      name: 'Spotify Playlist',
      trackIds: ['ytm-2'],
      tagIds: [],
      createdAt: 1,
      spotifyId: 'spotify-id',
    },
  ];

  const result = deriveLikedTrackSets({
    persistedLikedIds: ['ytm-1', 'ytm-2', 'local-1'],
    tracks,
    playlists,
  });

  assert.deepEqual(result.ytmLikedIds, ['ytm-1']);
  assert.deepEqual(result.localLikedIds, ['ytm-2', 'local-1']);
});

test('remote tracks are scoped to the selected YouTube Music account', () => {
  const accountA = { ...track('a'), ytAccountId: 'account-a' };
  const accountB = { ...track('b'), ytAccountId: 'account-b' };
  const legacyRemote = track('legacy-remote');
  const local = track('local', 'local');

  assert.deepEqual(
    scopeYtMusicTracksToAccount(
      [accountA, accountB, legacyRemote, local],
      'account-b',
    ).map((item) => item.id),
    ['b', 'local'],
  );
  assert.deepEqual(
    scopeYtMusicTracksToAccount([accountA, local], null).map((item) => item.id),
    ['local'],
  );

  const independent = scopeYtMusicTracksToAccount(
    [accountA, legacyRemote, local],
    'account-b',
    ['a', 'legacy-remote'],
  );
  assert.deepEqual(independent.map((item) => item.id), ['a', 'legacy-remote', 'local']);
  assert.equal(independent[0]?.ytAccountId, undefined);
});

test('independent local and Spotify playlist tracks survive account cleanup', () => {
  const playlists: Playlist[] = [
    {
      id: 'local-playlist',
      name: 'Local mix',
      trackIds: ['ytm-local-reference'],
      tagIds: [],
      createdAt: 1,
    },
    {
      id: 'sp-playlist',
      name: 'Spotify mix',
      trackIds: ['ytm-spotify-reference'],
      tagIds: [],
      createdAt: 2,
      spotifyId: 'spotify-id',
    },
    {
      id: 'ytpl-remote',
      name: 'Remote mix',
      trackIds: ['ytm-remote-reference'],
      tagIds: [],
      createdAt: 3,
      ytBrowseId: 'remote',
    },
  ];
  const independent = collectIndependentYtTrackIds(playlists, ['ytm-local-like']);
  assert.deepEqual(
    Array.from(independent).sort(),
    ['ytm-local-like', 'ytm-local-reference', 'ytm-spotify-reference'],
  );

  const tagged = tagYtMusicTracksForAccount(
    [
      track('ytm-remote-reference'),
      track('ytm-local-reference'),
      track('ytm-spotify-reference'),
    ],
    'account-a',
    independent,
  );
  assert.equal(tagged[0]?.ytAccountId, 'account-a');
  assert.equal(tagged[1]?.ytAccountId, undefined);
  assert.equal(tagged[2]?.ytAccountId, undefined);
});

test('persisted account ownership rejects mismatched and legacy remote state', () => {
  assert.equal(isPersistedYtAccountMatch('account-a', 'account-a'), true);
  assert.equal(isPersistedYtAccountMatch('account-b', 'account-a'), false);
  assert.equal(isPersistedYtAccountMatch('account-a', null), false);
  assert.equal(isPersistedYtAccountMatch(null, 'account-a'), false);

  assert.equal(
    isPersistedYtQueueOwnedByAccount('account-a', 'account-a', null),
    true,
  );
  assert.equal(
    isPersistedYtQueueOwnedByAccount('account-b', 'account-a', 'account-a'),
    false,
  );
  assert.equal(
    isPersistedYtQueueOwnedByAccount('account-a', null, 'account-a'),
    true,
  );
  assert.equal(
    isPersistedYtQueueOwnedByAccount('account-a', null, null),
    false,
  );
});

test('explicit liked sets round-trip without changing either source', () => {
  const result = deriveLikedTrackSets({
    persistedLikedIds: ['ytm-1', 'local-1'],
    persistedYtmLikedIds: ['ytm-1'],
    persistedLocalLikedIds: ['local-1'],
  });

  assert.deepEqual(result, {
    ytmLikedIds: ['ytm-1'],
    localLikedIds: ['local-1'],
  });

  assert.deepEqual(
    deriveLikedTrackSets({
      persistedLikedIds: ['ytm-1', 'local-1'],
      persistedLocalLikedIds: ['local-1'],
    }),
    {
      ytmLikedIds: [],
      localLikedIds: ['local-1'],
    },
  );
});

test('only an explicitly complete library snapshot is authoritative', () => {
  assert.equal(isAuthoritativeYtLibrarySnapshot({ ok: true, complete: true }), true);
  assert.equal(isAuthoritativeYtLibrarySnapshot({ ok: true, complete: false }), false);
  assert.equal(isAuthoritativeYtLibrarySnapshot({ ok: true }), false);
  assert.equal(isAuthoritativeYtLibrarySnapshot({ complete: true }), false);
});

test('playlist pruning and membership replacement require explicit completeness', () => {
  assert.equal(canPruneYtPlaylistManifest(true), true);
  assert.equal(canPruneYtPlaylistManifest(false), false);
  assert.equal(canPruneYtPlaylistManifest(undefined), false);

  assert.equal(canReplaceYtPlaylistTracks(true), true);
  assert.equal(canReplaceYtPlaylistTracks(false), false);
  assert.equal(canReplaceYtPlaylistTracks(undefined), false);
});

test('an incomplete playlist manifest does not prune remote playlists', () => {
  const existing: Playlist[] = [
    {
      id: 'ytpl-remote-old',
      name: 'Old remote playlist',
      trackIds: ['track-1'],
      tagIds: [],
      createdAt: 1,
      ytBrowseId: 'remote-old',
    },
    {
      id: 'local-playlist',
      name: 'Local playlist',
      trackIds: ['track-2'],
      tagIds: [],
      createdAt: 2,
    },
  ];

  const merged = mergeSyncedYtPlaylists(
    existing,
    [
      {
        browseId: 'remote-new',
        title: 'New remote playlist',
        tracks: [{ id: 'track-3' }],
        tracksComplete: true,
      },
    ],
    false,
  );

  assert.deepEqual(
    merged.map((playlist) => playlist.id),
    ['ytpl-remote-old', 'local-playlist', 'ytpl-remote-new'],
  );
});

test('a complete playlist manifest prunes only deleted remote playlists', () => {
  const existing: Playlist[] = [
    {
      id: 'ytpl-remote-old',
      name: 'Old remote playlist',
      trackIds: ['track-1'],
      tagIds: [],
      createdAt: 1,
      ytBrowseId: 'remote-old',
    },
    {
      id: 'local-playlist',
      name: 'Local playlist',
      trackIds: ['track-2'],
      tagIds: [],
      createdAt: 2,
    },
  ];

  const merged = mergeSyncedYtPlaylists(
    existing,
    [
      {
        browseId: 'remote-new',
        title: 'New remote playlist',
        tracks: [{ id: 'track-3' }],
        tracksComplete: true,
      },
    ],
    true,
  );

  assert.deepEqual(
    merged.map((playlist) => playlist.id),
    ['local-playlist', 'ytpl-remote-new'],
  );
});

test('incomplete playlist membership never replaces known membership', () => {
  const existing: Playlist[] = [
    {
      id: 'ytpl-remote',
      name: 'Remote playlist',
      trackIds: ['known-track'],
      tagIds: [],
      createdAt: 1,
      ytBrowseId: 'remote',
    },
  ];

  const incomplete = mergeSyncedYtPlaylists(
    existing,
    [
      {
        browseId: 'remote',
        title: 'Remote playlist',
        tracks: [{ id: 'partial-track' }],
        tracksComplete: false,
      },
    ],
    true,
  );
  assert.deepEqual(incomplete[0].trackIds, ['known-track']);

  const missingFlag = mergeSyncedYtPlaylists(
    existing,
    [
      {
        browseId: 'remote',
        title: 'Remote playlist',
        tracks: [{ id: 'partial-track' }],
      },
    ],
    true,
  );
  assert.deepEqual(missingFlag[0].trackIds, ['known-track']);

  const complete = mergeSyncedYtPlaylists(
    existing,
    [
      {
        browseId: 'remote',
        title: 'Remote playlist',
        tracks: [{ id: 'complete-track' }],
        tracksComplete: true,
      },
    ],
    true,
  );
  assert.deepEqual(complete[0].trackIds, ['complete-track']);
});
