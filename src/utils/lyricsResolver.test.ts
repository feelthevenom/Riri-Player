import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFirstLyricsCandidate } from './lyricsResolver.ts';

test('a synchronized lyrics result wins over an earlier plain result', async () => {
  type Candidate = {
    syncedLyrics: string | null;
    plainLyrics: string | null;
    provider: string;
  };
  const plain = Promise.resolve<Candidate>({
    syncedLyrics: null,
    plainLyrics: 'plain lyrics',
    provider: 'plain',
  });
  const synced = new Promise<Candidate>((resolve) => {
    setTimeout(() => resolve({
      syncedLyrics: '[00:01.00] synced lyrics',
      plainLyrics: null,
      provider: 'synced',
    }), 25);
  });

  const result = await resolveFirstLyricsCandidate([plain, synced]);

  assert.equal(result?.provider, 'synced');
  assert.equal(result?.syncedLyrics, '[00:01.00] synced lyrics');
});

test('a plain lyrics result is returned when no synchronized result arrives', async () => {
  const result = await resolveFirstLyricsCandidate([
    Promise.resolve({
      syncedLyrics: null,
      plainLyrics: 'plain lyrics',
      provider: 'plain',
    }),
  ]);

  assert.equal(result?.provider, 'plain');
  assert.equal(result?.plainLyrics, 'plain lyrics');
});

test('provider priority wins independently of plain-result arrival order', async () => {
  const higherPriority = new Promise<{
    syncedLyrics: null;
    plainLyrics: string;
    provider: string;
  }>((resolve) => setTimeout(() => resolve({
    syncedLyrics: null,
    plainLyrics: 'higher priority',
    provider: 'higher',
  }), 20));
  const lowerPriority = Promise.resolve({
    syncedLyrics: null,
    plainLyrics: 'lower priority',
    provider: 'lower',
  });

  const result = await resolveFirstLyricsCandidate(
    [
      { promise: higherPriority, rank: 0 },
      { promise: lowerPriority, rank: 3 },
    ],
    { plainGraceMs: 80 },
  );

  assert.equal(result?.provider, 'higher');
});

test('a late synchronized result is reported as a cache-upgrade candidate', async () => {
  type Candidate = {
    syncedLyrics: string | null;
    plainLyrics: string | null;
    provider: string;
  };
  const captured: { value: Candidate | null } = { value: null };
  const plain = Promise.resolve<Candidate>({
    syncedLyrics: null,
    plainLyrics: 'plain lyrics',
    provider: 'plain',
  });
  const synced = new Promise<Candidate>((resolve) => setTimeout(() => resolve({
    syncedLyrics: '[00:02.00] later synchronized lyrics',
    plainLyrics: null,
    provider: 'synced',
  }), 40));

  const result = await resolveFirstLyricsCandidate(
    [{ promise: plain, rank: 0 }, { promise: synced, rank: 1 }],
    {
      plainGraceMs: 5,
      onLateUpgrade: (candidate) => {
        captured.value = candidate;
      },
    },
  );

  assert.equal(result?.provider, 'plain');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(captured.value?.provider, 'synced');
});

test('a late lower-priority synchronized result cannot replace a better result', async () => {
  type Candidate = {
    syncedLyrics: string | null;
    plainLyrics: string | null;
    provider: string;
  };
  const upgrades: string[] = [];
  const higherPriority = new Promise<Candidate>((resolve) => setTimeout(() => resolve({
    syncedLyrics: '[00:01.00] higher priority',
    plainLyrics: null,
    provider: 'higher',
  }), 35));
  const lowerPriority = new Promise<Candidate>((resolve) => setTimeout(() => resolve({
    syncedLyrics: '[00:02.00] lower priority',
    plainLyrics: null,
    provider: 'lower',
  }), 50));

  const result = await resolveFirstLyricsCandidate(
    [{ promise: higherPriority, rank: 0 }, { promise: lowerPriority, rank: 3 }],
    {
      syncedGraceMs: 5,
      onLateUpgrade: (candidate) => {
        upgrades.push(candidate.provider);
      },
    },
  );

  assert.equal(result?.provider, 'higher');
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.deepEqual(upgrades, []);
});
