import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYtmCollectionResponse,
  selectMatchingLyricsBrowseId,
} from './homeSearchQueue.ts';

const albumArtworkUrl = 'https://lh3.googleusercontent.com/album-cover=w544-h544';

test('a lyrics browse ID is accepted only for its source video', () => {
  assert.equal(
    selectMatchingLyricsBrowseId('video-b', 'MPLYt-browse', 'video-b'),
    'MPLYt-browse',
  );
  assert.equal(
    selectMatchingLyricsBrowseId('video-b', 'MPLYt-a-browse', 'video-a'),
    undefined,
  );
  assert.equal(selectMatchingLyricsBrowseId('video-b', 'MPLYt-browse'), undefined);
});

test('album collection artwork is retained and used as the track fallback', () => {
  const response = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicResponsiveHeaderRenderer: {
                        title: { runs: [{ text: 'Coolie (Original Motion Picture Soundtrack)' }] },
                        subtitle: { runs: [{ text: 'Album • 2025' }] },
                        thumbnail: {
                          musicThumbnailRenderer: {
                            thumbnail: {
                              thumbnails: [{ url: albumArtworkUrl, width: 544, height: 544 }],
                            },
                          },
                        },
                      },
                    },
                    {
                      musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: '6iVTpjGewDc' },
                        flexColumns: [
                          {
                            musicResponsiveListItemFlexColumnRenderer: {
                              text: { runs: [{ text: 'Coolie Disco' }] },
                            },
                          },
                          {
                            musicResponsiveListItemFlexColumnRenderer: {
                              text: { runs: [{ text: 'Anirudh Ravichander' }] },
                            },
                          },
                          {
                            musicResponsiveListItemFlexColumnRenderer: {
                              text: {
                                runs: [
                                  {
                                    text: 'Misleading Album Column',
                                    navigationEndpoint: {
                                      browseEndpoint: { browseId: 'MPREb_wrong_album' },
                                    },
                                  },
                                ],
                              },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };

  const parsed = parseYtmCollectionResponse(response, 'MPREb_RgVXsiZnUCs');
  const expectedArtwork = `/api/proxy-image?url=${encodeURIComponent('https://lh3.googleusercontent.com/album-cover=w1200-h1200')}`;

  assert.equal(parsed.title, 'Coolie (Original Motion Picture Soundtrack)');
  assert.equal(parsed.thumbnailUrl, expectedArtwork);
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].thumbnailUrl, expectedArtwork);
  assert.equal(parsed.tracks[0].album, 'Coolie (Original Motion Picture Soundtrack)');
  assert.equal(parsed.tracks[0].albumId, 'MPREb_RgVXsiZnUCs');
});
