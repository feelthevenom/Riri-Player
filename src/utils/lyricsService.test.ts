import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LyricsService,
  type LyricsProvider,
  type LyricsResult,
} from './lyricsService.ts';

const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function lyricsResponse(overrides: Partial<LyricsResult> = {}): LyricsResult {
  return {
    ok: true,
    syncedLyrics: '[00:01.00] Hello',
    plainLyrics: 'Hello',
    source: 'LRCLIB',
    provider: 'lrclib',
    ...overrides,
  };
}

function installLocalStorage(): Map<string, string> {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      get length() {
        return values.size;
      },
    } satisfies Storage,
  });
  return values;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test('lyrics service caches a successful response', async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return jsonResponse(lyricsResponse());
  }) as typeof fetch;

  const service = new LyricsService();
  const payload = {
    title: 'Cached Song',
    artist: 'Cached Artist',
    videoId: 'cached-video',
    providers: ['lrclib' as const],
  };

  const first = await service.fetchLyrics(payload);
  const second = await service.fetchLyrics(payload);

  assert.equal(first.provider, 'lrclib');
  assert.equal(second.syncedLyrics, first.syncedLyrics);
  assert.equal(requests, 1);
});

test('lyrics service persists positive results across service instances', async () => {
  const storage = installLocalStorage();
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return jsonResponse(lyricsResponse());
  }) as typeof fetch;

  const payload = {
    title: 'Persisted Song',
    artist: 'Persisted Artist',
    videoId: 'persisted-video',
    providers: ['lrclib' as const],
  };
  await new LyricsService().fetchLyrics(payload);

  const persisted = JSON.parse(storage.get('ririp_c_lyrics_cache_v2') || '{}') as Record<
    string,
    { result?: { ok?: boolean } }
  >;
  assert.equal(Object.keys(persisted).length, 1);
  assert.equal(Object.values(persisted)[0].result?.ok, true);

  const restored = await new LyricsService().fetchLyrics(payload);
  assert.equal(restored.syncedLyrics, '[00:01.00] Hello');
  assert.equal(requests, 1);
});

test('lyrics service does not persist negative responses', async () => {
  const storage = installLocalStorage();
  globalThis.fetch = (async () =>
    jsonResponse({
      ok: false,
      syncedLyrics: '',
      plainLyrics: '',
      provider: 'none',
      source: '',
    })) as typeof fetch;

  await new LyricsService().fetchLyrics({
    title: 'Missing Persisted Song',
    artist: 'Missing Persisted Artist',
    videoId: 'missing-persisted-video',
    providers: ['lrclib'],
  });

  const persisted = JSON.parse(storage.get('ririp_c_lyrics_cache_v2') || '{}') as Record<
    string,
    unknown
  >;
  assert.deepEqual(persisted, {});
});

test('plain-only lyrics use a short cache lifetime', async () => {
  const storage = installLocalStorage();
  globalThis.fetch = (async () =>
    jsonResponse(lyricsResponse({
      syncedLyrics: null,
      plainLyrics: 'Plain only',
    }))) as typeof fetch;

  const before = Date.now();
  await new LyricsService().fetchLyrics({
    title: 'Plain Song',
    artist: 'Plain Artist',
    videoId: 'plain-video',
    providers: ['lrclib'],
  });

  const persisted = JSON.parse(storage.get('ririp_c_lyrics_cache_v2') || '{}') as Record<
    string,
    { expiresAt?: number }
  >;
  const expiresAt = Object.values(persisted)[0]?.expiresAt || 0;
  assert.ok(expiresAt > before);
  assert.ok(expiresAt <= before + 3 * 60 * 1000);
});

test('plain lyrics are upgraded when synchronized lyrics arrive later', async () => {
  installLocalStorage();
  let requests = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.includes('videoId=late-upgrade-video')) {
      return jsonResponse(lyricsResponse({
        syncedLyrics: null,
        plainLyrics: 'unrelated plain lyrics',
      }));
    }
    requests += 1;
    if (requests === 1) {
      return jsonResponse(lyricsResponse({
        syncedLyrics: null,
        plainLyrics: 'plain first',
      }));
    }
    return jsonResponse(lyricsResponse({
      syncedLyrics: '[00:03.00] synchronized later',
      plainLyrics: 'plain first',
    }));
  }) as typeof fetch;

  const service = new LyricsService();
  const payload = {
    title: 'Late Upgrade Song',
    artist: 'Late Upgrade Artist',
    videoId: 'late-upgrade-video',
    providers: ['lrclib' as const],
  };

  const first = await service.fetchLyrics(payload);
  assert.equal(first.syncedLyrics, null);
  assert.equal(first.plainLyrics, 'plain first');

  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const upgraded = await service.fetchLyrics(payload);

  assert.equal(upgraded.syncedLyrics, '[00:03.00] synchronized later');
  assert.equal(requests, 2);
});

test('SimpMusic accepts the singular plainLyric field', async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('/api/lyrics')) throw new Error('server unavailable');
    return jsonResponse({
      success: true,
      data: [{ plainLyric: 'SimpMusic plain lyrics' }],
    });
  }) as typeof fetch;

  const result = await new LyricsService().fetchLyrics({
    title: 'SimpMusic Song',
    artist: 'SimpMusic Artist',
    videoId: 'simpmusic-video',
    providers: ['simpmusic'],
  });

  assert.equal(result.provider, 'simpmusic');
  assert.equal(result.plainLyrics, 'SimpMusic plain lyrics');
});

test('lyrics service coalesces concurrent requests for the same track', async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return jsonResponse(lyricsResponse());
  }) as typeof fetch;

  const service = new LyricsService();
  const payload = {
    title: 'Concurrent Song',
    artist: 'Concurrent Artist',
    videoId: 'concurrent-video',
    providers: ['lrclib' as const],
  };

  const [first, second] = await Promise.all([
    service.fetchLyrics(payload),
    service.fetchLyrics(payload),
  ]);

  assert.equal(first.syncedLyrics, second.syncedLyrics);
  assert.equal(requests, 1);
});

test('a negative server response does not repeat every provider', async () => {
  let providerCalls = 0;
  const provider: LyricsProvider = {
    id: 'lrclib',
    name: 'Test provider',
    async fetchLyrics() {
      providerCalls += 1;
      return lyricsResponse();
    },
  };
  globalThis.fetch = (async () =>
    jsonResponse({
      ok: false,
      syncedLyrics: '',
      plainLyrics: '',
      provider: 'none',
      source: '',
    })) as typeof fetch;

  const service = new LyricsService();
  service.registerProvider(provider);
  const result = await service.fetchLyrics({
    title: 'Missing Song',
    artist: 'Missing Artist',
    videoId: 'missing-video',
    providers: ['lrclib'],
  });

  assert.equal(result.ok, false);
  assert.equal(providerCalls, 0);
});

test('direct providers are used when the local server is unavailable', async () => {
  globalThis.fetch = (async () => {
    throw new Error('server unavailable');
  }) as typeof fetch;

  let providerCalls = 0;
  const provider: LyricsProvider = {
    id: 'lrclib',
    name: 'Test provider',
    async fetchLyrics() {
      providerCalls += 1;
      return lyricsResponse({ provider: 'lrclib', source: 'Direct provider' });
    },
  };

  const service = new LyricsService();
  service.registerProvider(provider);
  const result = await service.fetchLyrics({
    title: 'Offline Song',
    artist: 'Offline Artist',
    videoId: 'offline-video',
    providers: ['lrclib'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'Direct provider');
  assert.equal(providerCalls, 1);
});

test('force refresh bypasses the client cache', async () => {
  let requests = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests += 1;
    const url = String(input);
    if (requests === 2) assert.match(url, /refresh=1/);
    return jsonResponse(lyricsResponse());
  }) as typeof fetch;

  const service = new LyricsService();
  const payload = {
    title: 'Refresh Song',
    artist: 'Refresh Artist',
    videoId: 'refresh-video',
    providers: ['lrclib' as const],
  };

  await service.fetchLyrics(payload);
  await service.fetchLyrics({ ...payload, forceRefresh: true });

  assert.equal(requests, 2);
});

test('force refresh replaces an older in-flight client request', async () => {
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests += 1;
    if (!String(input).includes('refresh=1')) {
      await gate;
      return jsonResponse(lyricsResponse({
        syncedLyrics: '[00:01.00] old',
        plainLyrics: 'old',
      }));
    }
    return jsonResponse(lyricsResponse({
      syncedLyrics: '[00:01.00] new',
      plainLyrics: 'new',
    }));
  }) as typeof fetch;

  const service = new LyricsService();
  const payload = {
    title: 'Concurrent Refresh Song',
    artist: 'Concurrent Refresh Artist',
    videoId: 'concurrent-refresh-video',
    providers: ['lrclib' as const],
  };

  const oldRequest = service.fetchLyrics(payload);
  const refreshed = await service.fetchLyrics({ ...payload, forceRefresh: true });
  release?.();
  const old = await oldRequest;

  assert.equal(old.syncedLyrics, '[00:01.00] old');
  assert.equal(refreshed.syncedLyrics, '[00:01.00] new');
  assert.equal(requests, 2);

  const cached = await service.fetchLyrics(payload);
  assert.equal(cached.syncedLyrics, '[00:01.00] new');
  assert.equal(requests, 2);
});

test('an aborted stale request is cancelled and is not cached as a failure', async () => {
  let requests = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requests += 1;
    const signal = init?.signal;
    return await new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
    });
  }) as typeof fetch;

  const service = new LyricsService();
  const payload = {
    title: 'Cancelled Song',
    artist: 'Cancelled Artist',
    videoId: 'cancelled-video',
    providers: ['lrclib' as const],
  };
  const controller = new AbortController();
  const staleRequest = service.fetchLyrics({ ...payload, signal: controller.signal });
  controller.abort();

  await assert.rejects(staleRequest, (error: unknown) => {
    return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');
  });

  globalThis.fetch = (async () => {
    requests += 1;
    return jsonResponse(lyricsResponse());
  }) as typeof fetch;
  const retry = await service.fetchLyrics(payload);

  assert.equal(retry.ok, true);
  assert.equal(requests, 2);
});

test('cancelling one waiter does not cancel a shared lyrics request', async () => {
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async () => {
    requests += 1;
    await gate;
    return jsonResponse(lyricsResponse());
  }) as typeof fetch;

  const service = new LyricsService();
  const payload = {
    title: 'Shared Song',
    artist: 'Shared Artist',
    videoId: 'shared-video',
    providers: ['lrclib' as const],
  };
  const controller = new AbortController();
  const staleRequest = service.fetchLyrics({ ...payload, signal: controller.signal });
  const sharedRequest = service.fetchLyrics(payload);
  controller.abort();

  await assert.rejects(staleRequest, (error: unknown) => {
    return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');
  });
  release?.();
  const result = await sharedRequest;

  assert.equal(result.ok, true);
  assert.equal(requests, 1);
});

test('concurrent force refresh requests are coalesced', async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return jsonResponse(lyricsResponse());
  }) as typeof fetch;

  const service = new LyricsService();
  const payload = {
    title: 'Concurrent Refresh Song',
    artist: 'Concurrent Refresh Artist',
    videoId: 'concurrent-refresh-video',
    providers: ['lrclib' as const],
    forceRefresh: true,
  };

  const [first, second] = await Promise.all([
    service.fetchLyrics(payload),
    service.fetchLyrics(payload),
  ]);

  assert.equal(first.syncedLyrics, second.syncedLyrics);
  assert.equal(requests, 1);
});
