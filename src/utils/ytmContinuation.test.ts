import test from 'node:test';
import assert from 'node:assert/strict';
import { extractYtMusicContinuation } from './ytmContinuation.ts';

const frameworkReloadResponse = {
  frameworkUpdates: {
    entityBatchUpdate: {
      mutations: [
        {
          payload: {
            commandEntity: {
              command: {
                browseSectionListReloadEndpoint: {
                  continuation: {
                    reloadContinuationData: {
                      continuation: 'framework-reload-token',
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  },
};

test('extractYtMusicContinuation ignores framework chip reload tokens', () => {
  const response = {
    ...frameworkReloadResponse,
    contents: {
      musicShelfRenderer: {
        continuationItemRenderer: {
          continuationEndpoint: {
            continuationCommand: {
              token: 'actual-item-token',
            },
          },
        },
      },
    },
  };

  assert.equal(extractYtMusicContinuation(response), 'actual-item-token');
});

test('extractYtMusicContinuation returns undefined without an item continuation', () => {
  assert.equal(extractYtMusicContinuation(frameworkReloadResponse), undefined);
});

test('extractYtMusicContinuation ignores chip reload tokens inside a section list', () => {
  const response = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        secondaryContents: {
          sectionListRenderer: {
            header: {
              chipCloudRenderer: {
                chips: [
                  {
                    chipCloudChipRenderer: {
                      navigationEndpoint: {
                        browseSectionListReloadEndpoint: {
                          continuation: {
                            reloadContinuationData: {
                              continuation: 'chip-reload-token',
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
            contents: [
              {
                musicPlaylistShelfRenderer: {
                  contents: [
                    {
                      musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 'video-1' },
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
  };

  assert.equal(extractYtMusicContinuation(response), undefined);
});

test('extractYtMusicContinuation ignores sort and filter reload commands', () => {
  const response = {
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  header: {
                    musicSideAlignedItemRenderer: {
                      endItems: [
                        {
                          musicSortFilterButtonRenderer: {
                            menu: {
                              musicMultiSelectMenuRenderer: {
                                options: [
                                  {
                                    musicMultiSelectMenuItemRenderer: {
                                      selectedCommand: {
                                        commandExecutorCommand: {
                                          commands: [
                                            {
                                              browseSectionListReloadEndpoint: {
                                                continuation: {
                                                  reloadContinuationData: {
                                                    continuation: 'sort-filter-reload-token',
                                                  },
                                                },
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
  };

  assert.equal(extractYtMusicContinuation(response), undefined);
});

test('extractYtMusicContinuation accepts a musicShelfRenderer reload continuation', () => {
  // Shape captured from a YouTube Music browse response: the token lives in
  // the shelf's own continuations list, not in a framework update.
  const response = {
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicShelfRenderer: {
                        title: { runs: [{ text: 'Songs' }] },
                        contents: [
                          {
                            musicResponsiveListItemRenderer: {
                              playlistItemData: { videoId: 'video-1' },
                            },
                          },
                        ],
                        continuations: [
                          {
                            reloadContinuationData: {
                              continuation: 'music-shelf-reload-token',
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

  assert.equal(
    extractYtMusicContinuation(response),
    'music-shelf-reload-token',
  );
});

test('extractYtMusicContinuation accepts reload tokens in playlist and grid contexts', () => {
  const token = 'item-reload-token';
  const contexts = [
    {
      musicPlaylistShelfRenderer: {
        continuations: [{ reloadContinuationData: { continuation: token } }],
      },
    },
    {
      gridRenderer: {
        continuations: [{ reloadContinuationData: { continuation: token } }],
      },
    },
  ];

  for (const response of contexts) {
    assert.equal(extractYtMusicContinuation(response), token);
  }
});

test('extractYtMusicContinuation ignores section-level reload commands', () => {
  const response = {
    sectionListRenderer: {
      continuations: [
        { reloadContinuationData: { continuation: 'section-reload-token' } },
      ],
    },
  };

  assert.equal(extractYtMusicContinuation(response), undefined);
});

test('extractYtMusicContinuation supports nextContinuationData', () => {
  assert.equal(
    extractYtMusicContinuation({
      continuations: [{ nextContinuationData: { continuation: 'next-page-token' } }],
    }),
    'next-page-token',
  );
});

test('item-shelf-only extraction ignores section-level suggestion pages', () => {
  const response = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        secondaryContents: {
          sectionListRenderer: {
            contents: [
              {
                musicPlaylistShelfRenderer: {
                  contents: [
                    {
                      musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 'video-1' },
                      },
                    },
                  ],
                },
              },
            ],
            continuations: [
              { nextContinuationData: { continuation: 'suggestions-page-token' } },
            ],
          },
        },
      },
    },
  };

  assert.equal(
    extractYtMusicContinuation(response, { itemShelfOnly: true }),
    undefined,
  );
  assert.equal(
    extractYtMusicContinuation(response),
    'suggestions-page-token',
  );
});

test('item-shelf-only extraction follows a shelf continuation', () => {
  const response = {
    musicPlaylistShelfRenderer: {
      contents: [
        {
          musicResponsiveListItemRenderer: {
            playlistItemData: { videoId: 'video-1' },
          },
        },
      ],
      continuations: [
        { reloadContinuationData: { continuation: 'playlist-page-2-token' } },
      ],
    },
  };

  assert.equal(
    extractYtMusicContinuation(response, { itemShelfOnly: true }),
    'playlist-page-2-token',
  );
});
