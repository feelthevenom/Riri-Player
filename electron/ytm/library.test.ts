import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browseAllTracks,
  browseAllTracksWithStatus,
  performYtmLibrarySync,
} from './library.ts';
import type { StoredYtAccount } from './credentials.ts';
import { innerTubePost, type InnerTubeRequestOptions } from './innertube.ts';

const account: StoredYtAccount = {
  id: 'account-a',
  name: 'Account A',
  email: 'a@example.com',
  accountIndex: 0,
  cookie: 'SAPISID=account-a-cookie; SID=account-a-session',
  visitorData: 'visitor-a',
  dataSyncId: 'account-a-sync',
  addedAt: 1,
};

function trackItem(videoId: string, title: string) {
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId },
      flexColumns: [
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: title }] },
          },
        },
      ],
    },
  };
}

function playlistCard(browseId: string, title: string) {
  return {
    musicTwoRowItemRenderer: {
      navigationEndpoint: { browseEndpoint: { browseId } },
      title: { runs: [{ text: title }] },
      subtitle: { runs: [{ text: 'YouTube Music playlist' }] },
      thumbnailRenderer: {
        musicThumbnailRenderer: {
          thumbnail: {
            thumbnails: [{ url: `https://example.test/${browseId}.jpg` }],
          },
        },
      },
    },
  };
}

function continuationItem(token: string) {
  return {
    continuationItemRenderer: {
      continuationEndpoint: { continuationCommand: { token } },
    },
  };
}

test('browseAllTracks includes the final page when pagination ends', async () => {
  const responses = [
    {
      items: [trackItem('video-1', 'First track')],
      continuationItemRenderer: {
        continuationEndpoint: { continuationCommand: { token: 'page-2' } },
      },
    },
    {
      items: [trackItem('video-2', 'Second track')],
    },
  ];
  const requests: InnerTubeRequestOptions[] = [];
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    requests.push(opts);
    return responses[requests.length - 1] as unknown as T;
  }) as typeof innerTubePost;

  const tracks = await browseAllTracks(
    'VLLM',
    'US',
    'en',
    account,
    4,
    false,
    request,
  );

  assert.equal(requests.length, 2);
  assert.deepEqual(
    tracks.map((track) => track.ytMusicVideoId),
    ['video-1', 'video-2'],
  );
});

test('browseAllTracks follows a genuine playlist shelf reload continuation', async () => {
  const responses = [
    {
      contents: {
        musicPlaylistShelfRenderer: {
          contents: [trackItem('video-1', 'First playlist track')],
          continuations: [
            { reloadContinuationData: { continuation: 'playlist-page-2' } },
          ],
        },
      },
    },
    {
      contents: {
        musicPlaylistShelfRenderer: {
          contents: [trackItem('video-2', 'Second playlist track')],
        },
      },
    },
  ];
  const requests: InnerTubeRequestOptions[] = [];
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    requests.push(opts);
    return responses[requests.length - 1] as unknown as T;
  }) as typeof innerTubePost;

  const tracks = await browseAllTracks(
    'VLPL-TEST',
    'US',
    'en',
    account,
    4,
    false,
    request,
  );

  assert.deepEqual(
    tracks.map((track) => track.ytMusicVideoId),
    ['video-1', 'video-2'],
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body?.continuation, 'playlist-page-2');
});

test('browseAllTracks ignores section-level suggestion continuations', async () => {
  const requests: InnerTubeRequestOptions[] = [];
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    requests.push(opts);
    return {
      contents: {
        twoColumnBrowseResultsRenderer: {
          secondaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  musicPlaylistShelfRenderer: {
                    contents: [trackItem('video-1', 'Playlist member')],
                  },
                },
              ],
              continuations: [
                {
                  nextContinuationData: {
                    continuation: 'suggestions-page-token',
                  },
                },
              ],
            },
          },
        },
      },
    } as unknown as T;
  }) as typeof innerTubePost;

  const tracks = await browseAllTracks(
    'VLPL-TEST',
    'US',
    'en',
    account,
    4,
    false,
    request,
  );

  assert.deepEqual(
    tracks.map((track) => track.ytMusicVideoId),
    ['video-1'],
  );
  assert.equal(requests.length, 1);
});

test('browseAllTracks propagates pagination request failures', async () => {
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    if (opts.body?.continuation) throw new Error('continuation failed');
    return {
      items: [trackItem('video-1', 'First track')],
      continuationItemRenderer: {
        continuationEndpoint: { continuationCommand: { token: 'page-2' } },
      },
    } as unknown as T;
  }) as typeof innerTubePost;

  await assert.rejects(
    () => browseAllTracks('VLLM', 'US', 'en', account, 4, false, request),
    /continuation failed/,
  );
});

test('browseAllTracksWithStatus marks a safety-limited result incomplete', async () => {
  const requests: InnerTubeRequestOptions[] = [];
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    requests.push(opts);
    return {
      items: [trackItem('video-1', 'First track')],
      continuationItemRenderer: continuationItem('page-2').continuationItemRenderer,
    } as unknown as T;
  }) as typeof innerTubePost;

  const result = await browseAllTracksWithStatus(
    'VLLM',
    'US',
    'en',
    account,
    1,
    false,
    request,
  );

  assert.equal(result.complete, false);
  assert.equal(result.items.length, 1);
  assert.match(result.incompleteReason || '', /safety limit/i);
  assert.equal(requests.length, 1);
});

test('library sync follows the complete remote playlist manifest without a 32-item cap', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) =>
    playlistCard(`VLPL${String(index + 1).padStart(3, '0')}`, `Playlist ${index + 1}`),
  );
  const secondPage = Array.from({ length: 20 }, (_, index) =>
    playlistCard(`VLPL${String(index + 21).padStart(3, '0')}`, `Playlist ${index + 21}`),
  );
  const requests: InnerTubeRequestOptions[] = [];
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    requests.push(opts);
    const browseId = String(opts.body?.browseId || '');
    const continuation = String(opts.body?.continuation || '');

    if (browseId === 'FEmusic_liked_playlists' && !continuation) {
      return {
        items: firstPage,
        continuationItemRenderer: continuationItem('manifest-page-2')
          .continuationItemRenderer,
      } as unknown as T;
    }
    if (continuation === 'manifest-page-2') {
      return { items: secondPage } as unknown as T;
    }
    if (browseId.startsWith('VLPL')) {
      return {
        items: [trackItem(`track-${browseId}`, `Track for ${browseId}`)],
      } as unknown as T;
    }
    return {} as T;
  }) as typeof innerTubePost;

  const result = await performYtmLibrarySync({ account, request });

  assert.equal(result.ok, true);
  assert.equal(result.complete, true);
  assert.equal(result.playlistsComplete, true);
  assert.equal(result.playlists.length, 40);
  assert.ok(result.playlists.every((playlist) => playlist.tracksComplete));
  assert.ok(result.playlists.every((playlist) => playlist.tracks.length === 1));
  assert.equal(
    requests.filter((opts) => opts.body?.continuation === 'manifest-page-2').length,
    1,
  );
  assert.ok(
    requests.every(
      (opts) =>
        opts.requireAuth === true && opts.accountOverride?.id === account.id,
    ),
  );
});

test('library sync explicitly marks an incomplete playlist track list', async () => {
  const requests: InnerTubeRequestOptions[] = [];
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    requests.push(opts);
    const browseId = String(opts.body?.browseId || '');
    if (browseId === 'FEmusic_liked_playlists') {
      return {
        items: [playlistCard('VLPL-INCOMPLETE', 'Incomplete playlist')],
      } as unknown as T;
    }
    if (browseId === 'VLPL-INCOMPLETE') {
      return {
        items: [trackItem('playlist-video-1', 'First playlist track')],
        continuationItemRenderer: continuationItem('playlist-page-2')
          .continuationItemRenderer,
      } as unknown as T;
    }
    return {} as T;
  }) as typeof innerTubePost;

  const result = await performYtmLibrarySync({
    account,
    request,
    paginationMaxPages: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.playlistsComplete, true);
  assert.equal(result.playlists.length, 1);
  assert.equal(result.playlists[0].tracksComplete, false);
  assert.equal(result.playlists[0].tracks.length, 1);
  assert.match(result.playlists[0].tracksIncompleteReason || '', /safety limit/i);
  assert.match(result.incompleteReason || '', /safety limit/i);
  assert.match(result.error || '', /safety limit/i);
});

test('library sync marks an incomplete remote playlist manifest', async () => {
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    const browseId = String(opts.body?.browseId || '');
    if (browseId === 'FEmusic_liked_playlists') {
      return {
        items: [playlistCard('VLPL-ONE', 'Playlist one')],
        continuationItemRenderer: continuationItem('manifest-page-2')
          .continuationItemRenderer,
      } as unknown as T;
    }
    return {} as T;
  }) as typeof innerTubePost;

  const result = await performYtmLibrarySync({
    account,
    request,
    paginationMaxPages: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.playlistsComplete, false);
  assert.match(result.incompleteReason || '', /playlist manifest/i);
  assert.match(result.error || '', /playlist manifest/i);
});

test('library sync fails the whole snapshot when a pagination request fails', async () => {
  const request = (async <T = Record<string, unknown>>(
    opts: InnerTubeRequestOptions,
  ): Promise<T> => {
    if (opts.body?.continuation) throw new Error('continuation failed');
    if (opts.body?.browseId === 'VLLM') {
      return {
        items: [trackItem('video-1', 'First track')],
        continuationItemRenderer: continuationItem('page-2').continuationItemRenderer,
      } as unknown as T;
    }
    return {} as T;
  }) as typeof innerTubePost;

  const result = await performYtmLibrarySync({ account, request });

  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.playlistsComplete, false);
  assert.deepEqual(result.likedTracks, []);
  assert.deepEqual(result.libraryTracks, []);
  assert.deepEqual(result.playlists, []);
  assert.match(result.error || '', /continuation failed/);
});
