import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bigramDiceSimilarity,
  computeDurationScore,
  extractBigrams,
  matchSpotifyScorePrecomputed,
  normalizeSpotifyMatchText,
  pickBestYtMatchForSpotifyTrack,
  precomputeSpotifyTrack,
} from './spotifyMapper';
import type { Track } from '../types/music';

test('normalizeSpotifyMatchText strips feat, brackets, remaster, remix noise and punctuation', () => {
  assert.equal(
    normalizeSpotifyMatchText('Midnight City (Remastered 2011) [Explicit]'),
    'midnight city',
  );
  assert.equal(
    normalizeSpotifyMatchText('Instant Crush (feat. Julian Casablancas)'),
    'instant crush',
  );
  assert.equal(
    normalizeSpotifyMatchText('One More Time (Club Remix)!'),
    'one more time',
  );
});

test('bigramDiceSimilarity computes exact 1.0 for identical and high score for near matches', () => {
  const a = normalizeSpotifyMatchText('Midnight City');
  const b = normalizeSpotifyMatchText('Midnite City');
  const c = normalizeSpotifyMatchText('Classical Concerto');
  assert.equal(bigramDiceSimilarity(a, extractBigrams(a), a, extractBigrams(a)), 1);
  assert.ok(bigramDiceSimilarity(a, extractBigrams(a), b, extractBigrams(b)) > 0.65);
  assert.ok(bigramDiceSimilarity(a, extractBigrams(a), c, extractBigrams(c)) < 0.25);
});

test('matchSpotifyScorePrecomputed rewards matching title, artist, and duration', () => {
  const pre = precomputeSpotifyTrack('Instant Crush', 'Daft Punk', 337_000);
  const exact = matchSpotifyScorePrecomputed(
    pre,
    'Instant Crush (feat. Julian Casablancas)',
    'Daft Punk',
    338,
  );
  const wrongDur = matchSpotifyScorePrecomputed(
    pre,
    'Instant Crush (1 Hour Loop)',
    'Cover Band',
    3600,
  );

  assert.equal(computeDurationScore(337_000, 338), 1.0);
  assert.ok(exact >= 0.85, `expected high score, got ${exact}`);
  assert.ok(exact > wrongDur);
});

test('pickBestYtMatchForSpotifyTrack selects closest candidate above 0.35 threshold', () => {
  const candidates: Track[] = [
    {
      id: 'ytm-wrong',
      title: 'Instant Crush Piano Tutorial',
      artist: 'Piano Covers',
      album: 'Tutorials',
      durationSec: 600,
      thumbnailUrl: '',
      streamUrl: '/api/ytmusic/stream?videoId=wrong1',
      ytMusicVideoId: 'wrong1',
      source: 'ytmusic',
    },
    {
      id: 'ytm-right',
      title: 'Instant Crush',
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      durationSec: 337,
      thumbnailUrl: '',
      streamUrl: '/api/ytmusic/stream?videoId=a5uQMwRMHcs',
      ytMusicVideoId: 'a5uQMwRMHcs',
      source: 'ytmusic',
    },
  ];

  const picked = pickBestYtMatchForSpotifyTrack(
    {
      name: 'Instant Crush',
      artist: 'Daft Punk',
      durationMs: 337_000,
    },
    candidates,
  );

  assert.equal(picked.match?.id, 'ytm-right');
  assert.ok(picked.bestScore >= 0.95);
});

test('pickBestYtMatchForSpotifyTrack rejects unrelated tracks below 0.35 threshold', () => {
  const candidates: Track[] = [
    {
      id: 'ytm-unrelated',
      title: 'Rainforest Thunder Sounds 10 Hours',
      artist: 'Nature Noise',
      album: 'Sleep',
      durationSec: 36000,
      thumbnailUrl: '',
      streamUrl: '/api/ytmusic/stream?videoId=xyz',
      ytMusicVideoId: 'xyz',
      source: 'ytmusic',
    },
  ];

  const picked = pickBestYtMatchForSpotifyTrack(
    {
      name: 'Starboy',
      artist: 'The Weeknd',
      durationMs: 230_000,
    },
    candidates,
  );

  assert.equal(picked.match, null);
  assert.ok(picked.bestScore < 0.35);
});
