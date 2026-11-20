import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSpotifyScheduleLabel,
  getSpotifySyncIntervalMs,
  isSpotifyAutoSyncDue,
} from './spotifySyncHelpers';

test('getSpotifySyncIntervalMs returns exact intervals for each schedule', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(getSpotifySyncIntervalMs('MANUAL'), null);
  assert.equal(getSpotifySyncIntervalMs('DAILY'), day);
  assert.equal(getSpotifySyncIntervalMs('WEEKLY'), 7 * day);
  assert.equal(getSpotifySyncIntervalMs('YEARLY'), 365 * day);
});

test('isSpotifyAutoSyncDue evaluates due state accurately', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_700_000_000_000;
  assert.equal(isSpotifyAutoSyncDue('MANUAL', undefined, now), false);
  assert.equal(isSpotifyAutoSyncDue('DAILY', undefined, now), true);
  assert.equal(isSpotifyAutoSyncDue('DAILY', now - day + 1000, now), false);
  assert.equal(isSpotifyAutoSyncDue('DAILY', now - day, now), true);
  assert.equal(isSpotifyAutoSyncDue('WEEKLY', now - 6 * day, now), false);
  assert.equal(isSpotifyAutoSyncDue('WEEKLY', now - 7 * day, now), true);
  assert.equal(isSpotifyAutoSyncDue('YEARLY', now - 365 * day, now), true);
});

test('formatSpotifyScheduleLabel returns readable labels', () => {
  assert.equal(formatSpotifyScheduleLabel('DAILY'), 'Every Day');
  assert.equal(formatSpotifyScheduleLabel('WEEKLY'), 'Every Week');
  assert.equal(formatSpotifyScheduleLabel('YEARLY'), 'Every Year');
  assert.equal(formatSpotifyScheduleLabel('MANUAL'), 'Manual Only');
});
