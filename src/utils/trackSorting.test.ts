import test from 'node:test';
import assert from 'node:assert/strict';
import { computeListeningStats, extractSpotifyPlaylistId, sortTracks } from './trackSorting';
import type { PlayEvent, Track } from '../types/music';

const sampleTracks: Track[] = [
  {
    id: '1',
    title: 'Zebra',
    artist: 'Beta',
    album: 'Gamma',
    durationSec: 210,
    thumbnailUrl: '',
    streamUrl: '',
    source: 'online',
  },
  {
    id: '2',
    title: 'Alpha',
    artist: 'Charlie',
    album: 'Alpha Album',
    durationSec: 120,
    thumbnailUrl: '',
    streamUrl: '',
    source: 'online',
  },
];

test('sortTracks sorts by title and duration', () => {
  const byTitleAsc = sortTracks(sampleTracks, 'title', 'asc');
  assert.deepEqual(
    byTitleAsc.map((t) => t.id),
    ['2', '1'],
  );

  const byDurDesc = sortTracks(sampleTracks, 'duration', 'desc');
  assert.deepEqual(
    byDurDesc.map((t) => t.id),
    ['1', '2'],
  );
});

test('extractSpotifyPlaylistId extracts IDs from URLs and URIs', () => {
  assert.equal(
    extractSpotifyPlaylistId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'),
    '37i9dQZF1DXcBWIGoYBM5M',
  );
  assert.equal(
    extractSpotifyPlaylistId('spotify:playlist:37i9dQZF1DX0XUsuxWHRQd'),
    '37i9dQZF1DX0XUsuxWHRQd',
  );
  assert.equal(extractSpotifyPlaylistId('https://example.com/playlist/123'), null);
});

test('computeListeningStats aggregates top tracks, artists, and time windows', () => {
  const now = 1_700_000_000_000;
  const events: PlayEvent[] = [
    {
      id: 'e1',
      trackId: 't1',
      title: 'Track One',
      artist: 'Artist A',
      album: 'Alb',
      thumbnailUrl: '',
      timestamp: now - 1000,
      durationPlayedSec: 180,
    },
    {
      id: 'e2',
      trackId: 't1',
      title: 'Track One',
      artist: 'Artist A',
      album: 'Alb',
      thumbnailUrl: '',
      timestamp: now - 2000,
      durationPlayedSec: 180,
    },
    {
      id: 'e3',
      trackId: 't2',
      title: 'Old Track',
      artist: 'Artist B',
      album: 'Alb2',
      thumbnailUrl: '',
      timestamp: now - 40 * 86400_000,
      durationPlayedSec: 240,
    },
  ];

  const weekStats = computeListeningStats(events, 'WEEK_1', now);
  assert.equal(weekStats.filteredCount, 2);
  assert.equal(weekStats.totalMinutes, 6);
  assert.equal(weekStats.topArtists[0].artist, 'Artist A');

  const allStats = computeListeningStats(events, 'ALL', now);
  assert.equal(allStats.filteredCount, 3);
  assert.equal(allStats.uniqueTracks, 2);
});
