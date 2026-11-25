import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncTtlCache } from './asyncTtlCache.ts';

test('async TTL cache returns a cached value before its expiry', async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new AsyncTtlCache<string>(() => now);

  const first = await cache.resolve('song', 500, async () => {
    calls += 1;
    return 'lyrics';
  });
  now += 499;
  const second = await cache.resolve('song', 500, async () => {
    calls += 1;
    return 'different';
  });

  assert.equal(first.status, 'miss');
  assert.equal(second.status, 'hit');
  assert.equal(second.value, 'lyrics');
  assert.equal(calls, 1);
});

test('async TTL cache coalesces concurrent requests', async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = new AsyncTtlCache<string>();

  const firstPromise = cache.resolve('song', 500, async () => {
    calls += 1;
    await gate;
    return 'lyrics';
  });
  const secondPromise = cache.resolve('song', 500, async () => {
    calls += 1;
    return 'different';
  });

  release?.();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first.status, 'miss');
  assert.equal(second.status, 'coalesced');
  assert.equal(first.value, second.value);
  assert.equal(calls, 1);
});

test('async TTL cache force refresh replaces an older in-flight response', async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = new AsyncTtlCache<string>();

  const oldRequest = cache.resolve('song', 500, async () => {
    calls += 1;
    await gate;
    return 'old';
  });
  const refreshed = await cache.resolve(
    'song',
    500,
    async () => {
      calls += 1;
      return 'new';
    },
    { forceRefresh: true },
  );
  release?.();
  const old = await oldRequest;

  assert.equal(old.value, 'old');
  assert.equal(refreshed.value, 'new');
  assert.equal(refreshed.status, 'miss');
  assert.equal(calls, 2);

  const cached = await cache.resolve('song', 500, async () => 'unexpected');
  assert.equal(cached.value, 'new');
  assert.equal(cached.status, 'hit');
});

test('async TTL cache force refresh bypasses an expired response', async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new AsyncTtlCache<string>(() => now);

  await cache.resolve('song', 100, async () => {
    calls += 1;
    return 'old';
  });
  now += 101;
  const refreshed = await cache.resolve(
    'song',
    100,
    async () => {
      calls += 1;
      return 'new';
    },
    { forceRefresh: true },
  );

  assert.equal(refreshed.status, 'miss');
  assert.equal(refreshed.value, 'new');
  assert.equal(calls, 2);
});

test('async TTL cache keeps a same-generation late upgrade', async () => {
  let generation = 0;
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const cache = new AsyncTtlCache<string>();

  const request = cache.resolve('song', 500, async (currentGeneration) => {
    generation = currentGeneration;
    started?.();
    await gate;
    return 'plain';
  });
  await requestStarted;

  assert.equal(cache.set('song', 'synchronized', 500, generation), true);
  release?.();
  await request;

  const cached = await cache.resolve('song', 500, async () => 'unexpected');
  assert.equal(cached.value, 'synchronized');
  assert.equal(cached.status, 'hit');
});

test('async TTL cache rejects a late update from an older generation', async () => {
  let oldGeneration = 0;
  const cache = new AsyncTtlCache<string>();

  await cache.resolve('song', 500, async (generation) => {
    oldGeneration = generation;
    return 'old';
  });
  const refreshed = await cache.resolve(
    'song',
    500,
    async () => 'new',
    { forceRefresh: true },
  );

  assert.equal(refreshed.value, 'new');
  assert.equal(cache.set('song', 'stale late result', 500, oldGeneration), false);
  const cached = await cache.resolve('song', 500, async () => 'unexpected');
  assert.equal(cached.value, 'new');
  assert.equal(cached.status, 'hit');
});
