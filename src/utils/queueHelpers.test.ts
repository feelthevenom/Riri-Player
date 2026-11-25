import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendUniqueQueueSuggestions,
  replaceUpcomingQueueWithRadio,
  shouldUseUnlimitedQueue,
} from './queueHelpers';
import { Track } from '../types/music';

const makeTrack = (id: string, ytMusicVideoId?: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  album: 'Album',
  durationSec: 180,
  thumbnailUrl: '',
  streamUrl: '',
  ytMusicVideoId,
  source: 'ytmusic',
});

test('appendUniqueQueueSuggestions deduplicates by id and ytMusicVideoId', () => {
  const existing = [makeTrack('ytm-abc', 'abc')];
  const incoming = [
    makeTrack('ytm-abc', 'abc'),
    makeTrack('other-abc', 'abc'),
    makeTrack('ytm-def', 'def'),
    makeTrack('ytm-ghi', 'ghi'),
  ];
  const merged = appendUniqueQueueSuggestions(existing, incoming);
  assert.deepEqual(
    merged.map((t) => t.id),
    ['ytm-abc', 'ytm-def', 'ytm-ghi'],
  );
});

test('replaceUpcomingQueueWithRadio keeps tracks up to activeIndex and replaces upcoming tracks', () => {
  const existing = [
    makeTrack('ytm-1', '1'),
    makeTrack('ytm-2', '2'),
    makeTrack('ytm-old', 'old'),
  ];
  const chipRadio = [makeTrack('ytm-2', '2'), makeTrack('ytm-new1', 'new1'), makeTrack('ytm-new2', 'new2')];
  const result = replaceUpcomingQueueWithRadio(existing, 1, chipRadio);
  assert.deepEqual(
    result.map((t) => t.id),
    ['ytm-1', 'ytm-2', 'ytm-new1', 'ytm-new2'],
  );
});

test('shouldUseUnlimitedQueue bounds playlist/library queues and allows unlimited for non-playlist tracks', () => {
  assert.equal(shouldUseUnlimitedQueue(true), false);
  assert.equal(shouldUseUnlimitedQueue(false), true);
  assert.equal(shouldUseUnlimitedQueue(true, { unlimited: true }), true);
  assert.equal(shouldUseUnlimitedQueue(false, { unlimited: false }), false);
  assert.equal(shouldUseUnlimitedQueue(true, { preserveQueueMode: true }, false), false);
  assert.equal(shouldUseUnlimitedQueue(true, { preserveQueueMode: true }, true), true);
});
