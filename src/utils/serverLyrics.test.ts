import assert from 'node:assert/strict';
import test from 'node:test';
import { startAppServer } from '../../server';

const originalFetch = globalThis.fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('server upgrades a plain-only cache entry when synchronized lyrics arrive later', async () => {
  let youlyCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) {
      return await originalFetch(input, init);
    }
    if (url.includes('lrclib.net')) {
      return json({ plainLyrics: 'plain from lrclib' });
    }
    if (url.includes('lyricsplus')) {
      youlyCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 650));
      return json({ lyrics: [{ time: 1000, text: 'synchronized from youlyplus' }] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const started = await startAppServer({
    port: 0,
    host: '127.0.0.1',
    enableViteDev: false,
  });
  try {
    const base = `http://127.0.0.1:${started.port}/api/lyrics`;
    const query = 'title=Upgrade&artist=Tester&videoId=server-upgrade-video&providers=lrclib,youlyplus';
    const first = await originalFetch(`${base}?${query}`);
    const firstBody = (await first.json()) as {
      syncedLyrics?: string;
      plainLyrics?: string;
    };

    assert.equal(firstBody.syncedLyrics, '');
    assert.equal(firstBody.plainLyrics, 'plain from lrclib');
    assert.equal(youlyCalls, 1);

    await new Promise((resolve) => setTimeout(resolve, 900));
    const second = await originalFetch(`${base}?${query}`);
    const secondBody = (await second.json()) as {
      syncedLyrics?: string;
      plainLyrics?: string;
    };

    assert.equal(secondBody.syncedLyrics, '[00:01.00] synchronized from youlyplus');
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test('server aborts provider requests when the client disconnects', async () => {
  let providerSignal: AbortSignal | undefined;
  let providerStarted: (() => void) | undefined;
  const providerRequestStarted = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) {
      return await originalFetch(input, init);
    }
    if (url.includes('lrclib.net')) {
      providerSignal = init?.signal || undefined;
      providerStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const started = await startAppServer({
    port: 0,
    host: '127.0.0.1',
    enableViteDev: false,
  });
  try {
    const controller = new AbortController();
    const request = originalFetch(
      `http://127.0.0.1:${started.port}/api/lyrics?title=Abort&artist=Tester&providers=lrclib`,
      { signal: controller.signal },
    );
    await providerRequestStarted;
    controller.abort();
    await assert.rejects(request);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(providerSignal?.aborted, true);
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test('server force refresh replaces an older in-flight provider response', async () => {
  let calls = 0;
  let releaseFirst: (() => void) | undefined;
  let firstStarted: (() => void) | undefined;
  let secondStarted: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstProviderStarted = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const secondProviderStarted = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) {
      return await originalFetch(input, init);
    }
    if (url.includes('lrclib.net')) {
      calls += 1;
      if (calls === 1) {
        firstStarted?.();
        await firstGate;
        return json({ plainLyrics: 'old response' });
      }
      secondStarted?.();
      return json({ plainLyrics: 'new response' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const started = await startAppServer({
    port: 0,
    host: '127.0.0.1',
    enableViteDev: false,
  });
  try {
    const base = `http://127.0.0.1:${started.port}/api/lyrics`;
    const query = 'title=Refresh&artist=Tester&videoId=server-force-video&providers=lrclib';
    const oldRequest = originalFetch(`${base}?${query}`).then(async (response) =>
      (await response.json()) as { plainLyrics?: string },
    );
    await firstProviderStarted;

    const refreshed = await originalFetch(`${base}?${query}&refresh=1`);
    const refreshedBody = (await refreshed.json()) as { plainLyrics?: string };
    await secondProviderStarted;
    releaseFirst?.();
    const oldBody = await oldRequest;

    assert.equal(refreshedBody.plainLyrics, 'new response');
    assert.equal(oldBody.plainLyrics, 'old response');

    const cached = await originalFetch(`${base}?${query}`);
    const cachedBody = (await cached.json()) as { plainLyrics?: string };
    assert.equal(cachedBody.plainLyrics, 'new response');
    assert.equal(calls, 2);
  } finally {
    releaseFirst?.();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});
