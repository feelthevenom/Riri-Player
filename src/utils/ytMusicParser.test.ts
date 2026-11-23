import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSapisidFromCookie,
  extractYtMusicPlaylistId,
  parseDurationTextToSec,
  parseInnertubeBrowseCards,
  parseInnertubeHomeFeed,
  parseInnertubeNext,
  parseInnertubeSearchItems,
  parseInnertubeSearchSuggestions,
  parseSignatureCipher,
} from './ytMusicParser.ts';

test('extractYtMusicPlaylistId parses YouTube Music URLs and bare IDs', () => {
  assert.equal(
    extractYtMusicPlaylistId('https://music.youtube.com/playlist?list=PL1234567890abcdef'),
    'PL1234567890abcdef',
  );
  assert.equal(
    extractYtMusicPlaylistId('https://www.youtube.com/playlist?list=OLAK5uy_k9x8y7z6w5'),
    'OLAK5uy_k9x8y7z6w5',
  );
  assert.equal(extractYtMusicPlaylistId('VLPLabcdef123456'), 'PLabcdef123456');
  assert.equal(extractYtMusicPlaylistId('LM'), 'LM');
  assert.equal(extractYtMusicPlaylistId('not a playlist'), null);
});

test('parseDurationTextToSec parses mm:ss and hh:mm:ss durations', () => {
  assert.equal(parseDurationTextToSec('3:45'), 225);
  assert.equal(parseDurationTextToSec('1:02:10'), 3730);
  assert.equal(parseDurationTextToSec('invalid'), 180);
});

test('extractSapisidFromCookie extracts SAPISID or __Secure-3PAPISID', () => {
  assert.equal(
    extractSapisidFromCookie('SID=abc; SAPISID=my_sapisid_value; HSID=xyz'),
    'my_sapisid_value',
  );
  assert.equal(
    extractSapisidFromCookie('__Secure-3PAPISID=secure_val; PREF=tz'),
    'secure_val',
  );
  assert.equal(extractSapisidFromCookie('SID=abc; HSID=xyz'), null);
});

test('parseSignatureCipher extracts base url, signature, and sp', () => {
  const parsed = parseSignatureCipher(
    's=abcDEF123&sp=sig&url=https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback%3Fid%3D1',
  );
  assert.equal(parsed?.s, 'abcDEF123');
  assert.equal(parsed?.sp, 'sig');
  assert.equal(parsed?.url, 'https://rr1.googlevideo.com/videoplayback?id=1');
});

test('parseInnertubeSearchItems extracts normalized tracks from InnerTube tree', () => {
  const sample = {
    contents: {
      musicShelfRenderer: {
        contents: [
          {
            musicResponsiveListItemRenderer: {
              playlistItemData: { videoId: 'dQw4w9WgXcQ' },
              thumbnail: {
                musicThumbnailRenderer: {
                  thumbnail: {
                    thumbnails: [{ url: 'https://lh3.googleusercontent.com/thumb.jpg', width: 544 }],
                  },
                },
              },
              flexColumns: [
                {
                  musicResponsiveListItemFlexColumnRenderer: {
                    text: { runs: [{ text: 'Midnight Synth' }] },
                  },
                },
                {
                  musicResponsiveListItemFlexColumnRenderer: {
                    text: {
                      runs: [
                        {
                          text: 'Neon Runner',
                          navigationEndpoint: { browseEndpoint: { browseId: 'UC12345' } },
                        },
                        { text: ' • ' },
                        {
                          text: 'Afterglow LP',
                          navigationEndpoint: { browseEndpoint: { browseId: 'MPRE67890' } },
                        },
                        { text: ' • ' },
                        { text: '4:12' },
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
  };

  const tracks = parseInnertubeSearchItems(sample);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].ytMusicVideoId, 'dQw4w9WgXcQ');
  assert.equal(tracks[0].title, 'Midnight Synth');
  assert.equal(tracks[0].artist, 'Neon Runner');
  assert.equal(tracks[0].album, 'Afterglow LP');
  assert.equal(tracks[0].durationSec, 252);
  assert.equal(tracks[0].source, 'ytmusic');
});

test('parseInnertubeHomeFeed parses carousel sections, mood chips, and playable songs', () => {
  const sampleHome = {
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  header: {
                    chipCloudRenderer: {
                      chips: [
                        {
                          chipCloudChipRenderer: {
                            text: { runs: [{ text: 'Energize' }] },
                            navigationEndpoint: {
                              browseEndpoint: { browseId: 'FEmusic_home', params: 'chip_param_1' },
                            },
                          },
                        },
                      ],
                    },
                  },
                  contents: [
                    {
                      musicCarouselShelfRenderer: {
                        header: {
                          musicCarouselShelfBasicHeaderRenderer: {
                            title: { runs: [{ text: 'Mixed for you' }] },
                          },
                        },
                        contents: [
                          {
                            musicTwoRowItemRenderer: {
                              title: { runs: [{ text: 'My Supermix' }] },
                              subtitle: { runs: [{ text: 'Riri Player' }, { text: ' • ' }, { text: 'Mix' }] },
                              navigationEndpoint: {
                                browseEndpoint: { browseId: 'VLRDCLAK5uy_mix1' },
                              },
                            },
                          },
                          {
                            musicTwoRowItemRenderer: {
                              title: { runs: [{ text: 'Instant Track' }] },
                              subtitle: { runs: [{ text: 'Daft Punk' }] },
                              navigationEndpoint: {
                                watchEndpoint: { videoId: 'vid999' },
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

  const feed = parseInnertubeHomeFeed(sampleHome);
  assert.equal(feed.chips.length, 1);
  assert.equal(feed.chips[0].title, 'Energize');
  assert.equal(feed.sections.length, 1);
  assert.equal(feed.sections[0].title, 'Mixed for you');
  assert.equal(feed.sections[0].items.length, 2);
  assert.equal(feed.tracks.length, 1);
  assert.equal(feed.tracks[0].ytMusicVideoId, 'vid999');
});

test('parseInnertubeBrowseCards & parseInnertubeSearchSuggestions parse library items and hints', () => {
  const albumGrid = {
    items: [
      {
        musicTwoRowItemRenderer: {
          title: { runs: [{ text: 'Random Access Memories' }] },
          subtitle: { runs: [{ text: 'Daft Punk' }] },
          navigationEndpoint: {
            browseEndpoint: {
              browseId: 'MPREb_12345',
              browseEndpointContextSupportedConfigs: {
                browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' },
              },
            },
          },
        },
      },
    ],
  };

  const albums = parseInnertubeBrowseCards(albumGrid, 'album');
  assert.equal(albums.length, 1);
  assert.equal(albums[0].kind, 'album');
  assert.equal(albums[0].browseId, 'MPREb_12345');

  const suggestJson = {
    contents: [
      {
        searchSuggestionsSectionRenderer: {
          contents: [
            { searchSuggestionRenderer: { suggestion: { runs: [{ text: 'daft punk' }, { text: ' discovery' }] } } },
          ],
        },
      },
    ],
  };
  const hints = parseInnertubeSearchSuggestions(suggestJson);
  assert.deepEqual(hints, ['daft punk discovery']);
});

test('parseInnertubeNext parses musicQueueRenderer, subHeaderChipCloud, automix, and continuations', () => {
  const initialJson = {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    musicQueueRenderer: {
                      subHeaderChipCloud: {
                        chipCloudRenderer: {
                          chips: [
                            {
                              chipCloudChipRenderer: {
                                text: { runs: [{ text: 'Familiar' }] },
                                selected: false,
                                navigationEndpoint: {
                                  watchEndpoint: { playlistId: 'RDAMVMabc', params: 'wAEB' },
                                },
                              },
                            },
                          ],
                        },
                      },
                      content: {
                        playlistPanelRenderer: {
                          continuations: [
                            { nextRadioContinuationData: { continuation: 'CONT_TOKEN_1' } },
                          ],
                          contents: [
                            {
                              playlistPanelVideoRenderer: {
                                videoId: 'vid_a',
                                title: { runs: [{ text: 'First Radio Song' }] },
                                longBylineText: {
                                  runs: [
                                    { text: 'Artist A', navigationEndpoint: { browseEndpoint: { browseId: 'UC_A' } } },
                                    { text: ' • ' },
                                    { text: 'Album A', navigationEndpoint: { browseEndpoint: { browseId: 'MPRE_A' } } },
                                  ],
                                },
                                lengthText: { runs: [{ text: '3:20' }] },
                              },
                            },
                            {
                              automixPreviewVideoRenderer: {
                                content: {
                                  automixPlaylistVideoRenderer: {
                                    navigationEndpoint: {
                                      watchPlaylistEndpoint: { playlistId: 'RDAMVMvid_a', params: 'wAEB' },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };

  const parsed = parseInnertubeNext(initialJson);
  assert.ok(parsed);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].ytMusicVideoId, 'vid_a');
  assert.equal(parsed.items[0].artist, 'Artist A');
  assert.equal(parsed.items[0].album, 'Album A');
  assert.equal(parsed.items[0].durationSec, 200);
  assert.ok(parsed.items[0].streamUrl.includes('/api/ytmusic/stream?'));
  assert.equal(parsed.continuation, 'CONT_TOKEN_1');
  assert.equal(parsed.automixEndpoint?.playlistId, 'RDAMVMvid_a');
  assert.equal(parsed.queueChips.length, 1);
  assert.equal(parsed.queueChips[0].title, 'Familiar');

  const contJson = {
    continuationContents: {
      playlistPanelContinuation: {
        continuations: [{ nextContinuationData: { continuation: 'CONT_TOKEN_2' } }],
        contents: [
          {
            playlistPanelVideoWrapperRenderer: {
              primaryRenderer: {
                playlistPanelVideoRenderer: {
                  videoId: 'vid_b',
                  title: { runs: [{ text: 'Second Radio Song' }] },
                  shortBylineText: { runs: [{ text: 'Artist B' }] },
                  lengthText: { runs: [{ text: '4:05' }] },
                },
              },
            },
          },
        ],
      },
    },
  };

  const parsedCont = parseInnertubeNext(contJson);
  assert.ok(parsedCont);
  assert.equal(parsedCont.items.length, 1);
  assert.equal(parsedCont.items[0].ytMusicVideoId, 'vid_b');
  assert.equal(parsedCont.continuation, 'CONT_TOKEN_2');
});
