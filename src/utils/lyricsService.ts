/**
 * Lyrics Service - Multi-provider lyrics fetching with resilient caching.
 *
 * The primary path uses the local server endpoint (which avoids browser CORS
 * restrictions and can run the providers concurrently). Direct provider calls
 * are retained as an offline/server-unavailable fallback.
 */

import type { LyricsProviderId } from '../types/music';
import {
  RankedLyricsTask,
  resolveFirstLyricsCandidate,
} from './lyricsResolver';
import { apiFetch, getElectronBridge, ytmClient } from './ytmClient';

export interface LyricsResult {
  ok: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  source: string;
  provider: string;
}

export interface FetchLyricsPayload {
  title: string;
  artist: string;
  videoId?: string;
  duration?: number;
  lyricsBrowseId?: string;
  lyricsBrowseVideoId?: string;
  gl?: string;
  hl?: string;
  providers?: LyricsProviderId[];
  signal?: AbortSignal;
  forceRefresh?: boolean;
}

export interface LyricsProvider {
  id: LyricsProviderId;
  name: string;
  fetchLyrics(payload: FetchLyricsPayload): Promise<LyricsResult | null>;
}

const ALL_PROVIDERS: LyricsProviderId[] = [
  'lrclib',
  'youlyplus',
  'kugou',
  'simpmusic',
  'ytm',
];
const PERSISTED_CACHE_KEY = 'ririp_c_lyrics_cache_v2';
const POSITIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PLAIN_ONLY_CACHE_TTL_MS = 2 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PERSISTED_ENTRIES = 80;

interface PersistedLyricsEntry {
  expiresAt: number;
  result: LyricsResult;
  /** Lower values are higher priority within the requested provider order. */
  priority?: number;
}

type PersistedLyricsCache = Record<string, PersistedLyricsEntry>;

function formatLrcTimestamp(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`;
}

function normalizeText(value: string | undefined | null): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function decodeBase64Utf8(value: string): string {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  // Node/test fallback. The browser path above avoids bundling a Buffer polyfill.
  return Buffer.from(value, 'base64').toString('utf8');
}

async function withRequestSignal<T>(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parentSignal?.aborted) {
    throw parentSignal.reason || new DOMException('Request aborted', 'AbortError');
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Lyrics request timed out')), timeoutMs);

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError',
  );
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException('Lyrics request aborted', 'AbortError');
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * LRCLIB provider - Fast, crowdsourced synchronized LRC database.
 */
class LrclibProvider implements LyricsProvider {
  id: LyricsProviderId = 'lrclib';
  name = 'LRCLIB';

  async fetchLyrics(payload: FetchLyricsPayload): Promise<LyricsResult | null> {
    try {
      const url = new URL('https://lrclib.net/api/get');
      url.searchParams.set('track_name', payload.title);
      url.searchParams.set('artist_name', payload.artist);
      if (payload.duration && payload.duration > 0) {
        url.searchParams.set('duration', String(Math.round(payload.duration)));
      }

      const res = await withRequestSignal(6000, payload.signal, (signal) =>
        fetch(url.toString(), {
          headers: { 'User-Agent': 'RiriPlayer/1.2 (ArchiveTune-Engine)' },
          signal,
        }),
      );
      if (!res.ok) return null;

      const data = (await res.json()) as {
        syncedLyrics?: string;
        plainLyrics?: string;
      };
      if (data.syncedLyrics || data.plainLyrics) {
        return {
          ok: true,
          syncedLyrics: data.syncedLyrics || null,
          plainLyrics: data.plainLyrics || null,
          source: 'LRCLIB',
          provider: 'lrclib',
        };
      }
    } catch {
      // Fall through to another provider.
    }
    return null;
  }
}

/**
 * YouLyPlus provider - High-precision word & line synchronized lyrics proxy.
 */
class YouLyPlusProvider implements LyricsProvider {
  id: LyricsProviderId = 'youlyplus';
  name = 'YouLy+';

  async fetchLyrics(payload: FetchLyricsPayload): Promise<LyricsResult | null> {
    const baseUrls = [
      'https://lyricsplus.prjktla.my.id/',
      'https://lyricsplus.atomix.one/',
    ];
    for (const base of baseUrls) {
      try {
        const url = `${base}v2/lyrics/get?title=${encodeURIComponent(payload.title)}&artist=${encodeURIComponent(payload.artist)}`;
        const res = await withRequestSignal(5000, payload.signal, (signal) =>
          fetch(url, {
            headers: { 'User-Agent': 'ArchiveTune' },
            signal,
          }),
        );
        if (!res.ok) continue;
        const data = (await res.json()) as {
          lyrics?: Array<{ time?: number; text?: string }>;
        };
        if (Array.isArray(data?.lyrics) && data.lyrics.length > 0) {
          const lrcLines = data.lyrics
            .filter((line) => typeof line.time === 'number' && typeof line.text === 'string')
            .map((line) => `${formatLrcTimestamp(line.time!)} ${line.text!.trim()}`)
            .join('\n');
          const plainLines = data.lyrics
            .map((line) => line.text?.trim() || '')
            .filter(Boolean)
            .join('\n');
          return {
            ok: true,
            syncedLyrics: lrcLines || null,
            plainLyrics: plainLines || null,
            source: 'YouLy+',
            provider: 'youlyplus',
          };
        }
      } catch {
        // Try the next mirror.
      }
    }
    return null;
  }
}

/**
 * KuGou Music provider - Large synchronized LRC library.
 */
class KuGouProvider implements LyricsProvider {
  id: LyricsProviderId = 'kugou';
  name = 'KuGou Music';

  async fetchLyrics(payload: FetchLyricsPayload): Promise<LyricsResult | null> {
    try {
      const keyword = `${payload.title} ${payload.artist}`.trim();
      const searchUrl = `https://mobileservice.kugou.com/api/v3/search/song?version=9108&plat=0&pagesize=8&showtype=0&keyword=${encodeURIComponent(keyword)}`;
      const searchRes = await withRequestSignal(6000, payload.signal, (signal) =>
        fetch(searchUrl, { signal }),
      );
      if (!searchRes.ok) return null;
      const searchData = (await searchRes.json()) as {
        data?: { info?: Array<{ hash: string; duration: number }> };
      };
      const songs = searchData?.data?.info || [];
      if (songs.length === 0) return null;

      for (const song of songs.slice(0, 4)) {
        if (
          payload.duration &&
          payload.duration > 0 &&
          Math.abs(song.duration - payload.duration) > 15
        ) {
          continue;
        }
        try {
          const candidateUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${song.hash}`;
          const candidateRes = await withRequestSignal(4000, payload.signal, (signal) =>
            fetch(candidateUrl, { signal }),
          );
          if (!candidateRes.ok) continue;
          const candidateData = (await candidateRes.json()) as {
            candidates?: Array<{ id: string | number; accesskey: string }>;
          };
          const candidate = candidateData?.candidates?.[0];
          if (!candidate) continue;

          const downloadUrl = `https://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=lrc&charset=utf8`;
          const downloadRes = await withRequestSignal(5000, payload.signal, (signal) =>
            fetch(downloadUrl, { signal }),
          );
          if (!downloadRes.ok) continue;
          const downloadData = (await downloadRes.json()) as { content?: string };
          if (downloadData?.content) {
            const lrc = decodeBase64Utf8(downloadData.content);
            if (lrc.length > 20) {
              return {
                ok: true,
                syncedLyrics: lrc,
                plainLyrics: null,
                source: 'KuGou Music',
                provider: 'kugou',
              };
            }
          }
        } catch {
          // Try the next candidate.
        }
      }
    } catch {
      // Ignore provider failures.
    }
    return null;
  }
}

/**
 * SimpMusic provider - Synchronized lyrics indexed by YouTube video ID.
 */
class SimpMusicProvider implements LyricsProvider {
  id: LyricsProviderId = 'simpmusic';
  name = 'SimpMusic';

  async fetchLyrics(payload: FetchLyricsPayload): Promise<LyricsResult | null> {
    if (!payload.videoId) return null;
    try {
      const url = `https://api-lyrics.simpmusic.org/v1/${payload.videoId}`;
      const res = await withRequestSignal(5000, payload.signal, (signal) =>
        fetch(url, {
          headers: { 'User-Agent': 'SimpMusicLyrics/1.0', Accept: 'application/json' },
          signal,
        }),
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        success?: boolean;
        data?: Array<{ syncedLyrics?: string; plainLyrics?: string; plainLyric?: string }>;
      };
      if (data?.success && Array.isArray(data.data) && data.data.length > 0) {
        const item = data.data[0];
        const plainLyrics = item.plainLyrics || item.plainLyric || null;
        if (item.syncedLyrics || plainLyrics) {
          return {
            ok: true,
            syncedLyrics: item.syncedLyrics || null,
            plainLyrics,
            source: 'SimpMusic',
            provider: 'simpmusic',
          };
        }
      }
    } catch {
      // Ignore provider failures.
    }
    return null;
  }
}

/**
 * YouTube Music provider - Uses the Electron main process so the request uses
 * the verified account credentials from the encrypted vault.
 */
class YtmLyricsProvider implements LyricsProvider {
  id: LyricsProviderId = 'ytm';
  name = 'YouTube Music';

  async fetchLyrics(payload: FetchLyricsPayload): Promise<LyricsResult | null> {
    if (!payload.videoId) return null;
    try {
      const data = await withRequestSignal(10000, payload.signal, async (signal) => {
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000));
        return await Promise.race([
          raceWithSignal(
            ytmClient.getYtmLyrics({
              videoId: payload.videoId,
              lyricsBrowseId: payload.lyricsBrowseId,
              lyricsBrowseVideoId: payload.lyricsBrowseVideoId,
              gl: payload.gl,
              hl: payload.hl,
            }),
            signal,
          ),
          timeout,
        ]);
      });
      if (data?.plainLyrics) {
        return {
          ok: true,
          syncedLyrics: null,
          plainLyrics: data.plainLyrics,
          source: data.source || 'YouTube Music',
          provider: 'ytm',
        };
      }
    } catch {
      // Ignore provider failures.
    }
    return null;
  }
}

/**
 * Resolves direct-provider calls concurrently. A synchronized result wins over
 * a plain-only result, while a short grace period allows a slower synchronized
 * provider to replace an early plain response.
 */
async function fetchFirstDirectProvider(
  providers: LyricsProvider[],
  payload: FetchLyricsPayload,
): Promise<LyricsResult | null> {
  if (providers.length === 0) return null;

  const tasks: RankedLyricsTask<LyricsResult>[] = providers.map((provider, index) => ({
    rank: index,
    promise: (async () => {
      // Give earlier providers a small head start so the user's configured
      // priority remains meaningful without restoring fully sequential waits.
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, index * 120));
      }
      return await provider.fetchLyrics(payload);
    })(),
  }));
  return await resolveFirstLyricsCandidate(tasks);
}

interface InFlightLyricsRequest {
  key: string;
  promise: Promise<LyricsResult>;
  controller: AbortController;
  forceRefresh: boolean;
  subscribers: number;
}

export class LyricsService {
  private providerRegistry = new Map<LyricsProviderId, LyricsProvider>();
  private memoryCache = new Map<string, PersistedLyricsEntry>();
  private inFlight = new Map<string, InFlightLyricsRequest>();
  private cacheGenerations = new Map<string, number>();

  constructor() {
    this.registerProvider(new LrclibProvider());
    this.registerProvider(new YouLyPlusProvider());
    this.registerProvider(new KuGouProvider());
    this.registerProvider(new SimpMusicProvider());
    this.registerProvider(new YtmLyricsProvider());
    this.hydratePersistedCache();
  }

  registerProvider(provider: LyricsProvider): void {
    this.providerRegistry.set(provider.id, provider);
  }

  clearCache(): void {
    this.memoryCache.clear();
    this.cacheGenerations.clear();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(PERSISTED_CACHE_KEY);
      }
    } catch {
      // Ignore unavailable/blocked storage.
    }
  }

  private getProviderOrder(payload: FetchLyricsPayload): LyricsProviderId[] {
    const requested = payload.providers?.filter((provider) => ALL_PROVIDERS.includes(provider)) || [];
    const order = requested.length > 0 ? requested : ALL_PROVIDERS;
    return Array.from(new Set(order));
  }

  private getProviderPriority(
    result: LyricsResult,
    providerOrder: LyricsProviderId[],
  ): number | undefined {
    const index = providerOrder.indexOf(result.provider as LyricsProviderId);
    return index >= 0 ? index : undefined;
  }

  private getCacheKey(payload: FetchLyricsPayload, providerOrder: LyricsProviderId[]): string {
    const identity = payload.videoId
      ? `video:${payload.videoId}`
      : `title:${normalizeText(payload.title)}|artist:${normalizeText(payload.artist)}|duration:${Math.round(payload.duration || 0)}`;
    return [
      identity,
      `providers:${providerOrder.join(',')}`,
      `gl:${payload.gl || 'US'}`,
      `hl:${payload.hl || 'en'}`,
    ].join('|');
  }

  private hydratePersistedCache(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const parsed = JSON.parse(localStorage.getItem(PERSISTED_CACHE_KEY) || '{}') as PersistedLyricsCache;
      const now = Date.now();
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry?.expiresAt && entry.expiresAt > now && entry.result?.ok) {
          this.memoryCache.set(key, entry);
        }
      }
    } catch {
      // Ignore malformed or unavailable persistent cache data.
    }
  }

  private persistCache(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const now = Date.now();
      const entries = Array.from(this.memoryCache.entries())
        .filter(([, entry]) => entry.expiresAt > now && entry.result.ok)
        .sort(([, left], [, right]) => right.expiresAt - left.expiresAt)
        .slice(0, MAX_PERSISTED_ENTRIES);
      const persisted: PersistedLyricsCache = Object.fromEntries(entries);
      localStorage.setItem(PERSISTED_CACHE_KEY, JSON.stringify(persisted));
    } catch {
      // Storage is an optimization; the in-memory cache remains usable.
    }
  }

  private readCache(key: string): LyricsResult | null {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.result;
  }

  private writeCache(key: string, result: LyricsResult, priority?: number): void {
    const existing = this.memoryCache.get(key);
    if (
      existing?.result.syncedLyrics &&
      result.syncedLyrics &&
      existing.priority !== undefined &&
      priority !== undefined &&
      priority > existing.priority
    ) {
      // A lower-priority synchronized provider must not replace a result that
      // was already obtained from a higher-priority provider.
      return;
    }

    const ttl = !result.ok
      ? NEGATIVE_CACHE_TTL_MS
      : result.syncedLyrics
        ? POSITIVE_CACHE_TTL_MS
        : PLAIN_ONLY_CACHE_TTL_MS;
    this.memoryCache.set(key, {
      expiresAt: Date.now() + ttl,
      result,
      priority,
    });
    this.persistCache();
  }

  private async fetchFromServer(
    payload: FetchLyricsPayload,
    providerOrder: LyricsProviderId[],
  ): Promise<LyricsResult | null> {
    const query = new URLSearchParams({
      title: payload.title,
      artist: payload.artist,
      providers: providerOrder.join(','),
    });
    if (payload.videoId) query.set('videoId', payload.videoId);
    if (payload.duration) query.set('duration', String(payload.duration));
    if (payload.gl) query.set('gl', payload.gl);
    if (payload.hl) query.set('hl', payload.hl);
    if (payload.forceRefresh) query.set('refresh', '1');

    const response = await withRequestSignal(12000, payload.signal, (signal) =>
      apiFetch(`/api/lyrics?${query.toString()}`, { signal }),
    );
    if (!response.ok) {
      throw new Error(`Lyrics server request failed (${response.status})`);
    }
    const data = (await response.json()) as Partial<LyricsResult>;
    if (data.ok && (data.syncedLyrics || data.plainLyrics)) {
      return {
        ok: true,
        syncedLyrics: data.syncedLyrics || null,
        plainLyrics: data.plainLyrics || null,
        source: data.source || 'YouTube Music',
        provider: data.provider || 'none',
      };
    }
    return null;
  }

  private async fetchDirect(
    payload: FetchLyricsPayload,
    providerOrder: LyricsProviderId[],
  ): Promise<LyricsResult | null> {
    const providers = providerOrder
      .map((id) => this.providerRegistry.get(id))
      .filter((provider): provider is LyricsProvider => Boolean(provider));
    return await fetchFirstDirectProvider(providers, payload);
  }

  private async resolveRequest(
    cacheKey: string,
    payload: FetchLyricsPayload,
    providerOrder: LyricsProviderId[],
    controller: AbortController,
    shouldCache: () => boolean,
  ): Promise<LyricsResult> {
    const internalPayload: FetchLyricsPayload = {
      ...payload,
      signal: controller.signal,
    };
    const electronYtmAvailable = Boolean(getElectronBridge()?.queue?.lyrics);
    const serverProviderOrder = electronYtmAvailable
      ? providerOrder.filter((provider) => provider !== 'ytm')
      : providerOrder;
    const tasks: RankedLyricsTask<LyricsResult>[] = [];

    if (serverProviderOrder.length > 0) {
      tasks.push({
        rank: Math.max(0, providerOrder.indexOf(serverProviderOrder[0])),
        promise: (async () => {
          try {
            return await this.fetchFromServer(internalPayload, serverProviderOrder);
          } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) throw error;
            // The unified endpoint is unavailable; use direct provider calls.
            const directOrder = providerOrder.filter((provider) => provider !== 'ytm');
            return await this.fetchDirect(internalPayload, directOrder);
          }
        })(),
      });
    }

    if (electronYtmAvailable && providerOrder.includes('ytm')) {
      // The Electron main process owns the encrypted account credentials, so
      // use its authenticated YTM lyrics channel in parallel with the HTTP
      // providers. Its configured global rank is retained so a lower-priority
      // YTM result cannot bypass a higher-priority provider.
      const ytmRank = Math.max(0, providerOrder.indexOf('ytm'));
      tasks.push({
        rank: ytmRank,
        promise: (async () => {
          if (ytmRank > 0) {
            await new Promise((resolve) => setTimeout(resolve, ytmRank * 120));
          }
          return await this.fetchDirect(internalPayload, ['ytm']);
        })(),
      });
    }

    const result = await resolveFirstLyricsCandidate(tasks, {
      getPriority: (candidate, fallbackRank) => {
        const providerIndex = providerOrder.indexOf(candidate.provider as LyricsProviderId);
        return providerIndex >= 0 ? providerIndex : fallbackRank;
      },
      onLateUpgrade: (candidate) => {
        if (!candidate.syncedLyrics || !shouldCache()) return;
        this.writeCache(
          cacheKey,
          candidate,
          this.getProviderPriority(candidate, providerOrder),
        );
      },
    });
    if (controller.signal.aborted) throw abortError(controller.signal);

    const finalResult: LyricsResult = result || {
      ok: false,
      syncedLyrics: null,
      plainLyrics: null,
      source: '',
      provider: 'none',
    };
    if (shouldCache()) {
      this.writeCache(
        cacheKey,
        finalResult,
        this.getProviderPriority(finalResult, providerOrder),
      );
    }

    if (finalResult.ok && !finalResult.syncedLyrics && finalResult.plainLyrics) {
      // Plain-only lyrics are intentionally short-lived. The server keeps its
      // provider tasks alive and upgrades its cache if synchronized lyrics
      // arrive later; these follow-ups copy that upgrade into the client cache
      // without delaying the initial plain response.
      const serverOrder = serverProviderOrder;
      if (serverOrder.length > 0) {
        const delays = [900, 2_600, 6_500];
        const scheduleUpgradeCheck = (index: number): void => {
          if (index >= delays.length) return;
          const timer = setTimeout(() => {
            if (!shouldCache()) return;
            void this.fetchFromServer(
              { ...payload, forceRefresh: false, signal: undefined },
              serverOrder,
            )
              .then((upgraded) => {
                if (upgraded?.syncedLyrics && shouldCache()) {
                  this.writeCache(
                    cacheKey,
                    upgraded,
                    this.getProviderPriority(upgraded, providerOrder),
                  );
                  return;
                }
                scheduleUpgradeCheck(index + 1);
              })
              .catch(() => scheduleUpgradeCheck(index + 1));
          }, delays[index]);
          // Do not keep a Node test process alive solely for a background cache
          // upgrade. Browser timers do not expose `unref`, so this is safe in
          // both environments.
          (timer as unknown as { unref?: () => void }).unref?.();
        };
        scheduleUpgradeCheck(0);
      }
    }
    return finalResult;
  }

  private async waitForRequest(
    entry: InFlightLyricsRequest,
    signal: AbortSignal | undefined,
  ): Promise<LyricsResult> {
    entry.subscribers += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entry.subscribers -= 1;
      if (entry.subscribers === 0 && !entry.controller.signal.aborted) {
        entry.controller.abort(abortError());
        if (this.inFlight.get(entry.key) === entry) {
          this.inFlight.delete(entry.key);
        }
      }
    };

    try {
      if (!signal) return await entry.promise;
      return await raceWithSignal(entry.promise, signal);
    } finally {
      release();
    }
  }

  async fetchLyrics(payload: FetchLyricsPayload): Promise<LyricsResult> {
    const providerOrder = this.getProviderOrder(payload);
    const cacheKey = this.getCacheKey(payload, providerOrder);

    if (!payload.forceRefresh) {
      const cached = this.readCache(cacheKey);
      if (cached) return cached;
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing && (!payload.forceRefresh || existing.forceRefresh)) {
      return await this.waitForRequest(existing, payload.signal);
    }

    const generation = (this.cacheGenerations.get(cacheKey) || 0) + 1;
    this.cacheGenerations.set(cacheKey, generation);
    const controller = new AbortController();
    let entry: InFlightLyricsRequest;
    const promise = this.resolveRequest(
      cacheKey,
      payload,
      providerOrder,
      controller,
      () => this.cacheGenerations.get(cacheKey) === generation,
    );
    entry = {
      key: cacheKey,
      promise,
      controller,
      forceRefresh: Boolean(payload.forceRefresh),
      subscribers: 0,
    };
    this.inFlight.set(cacheKey, entry);
    const cleanup = () => {
      if (this.inFlight.get(cacheKey) === entry) {
        this.inFlight.delete(cacheKey);
      }
    };
    void promise.then(cleanup, cleanup);

    return await this.waitForRequest(entry, payload.signal);
  }
}

export const lyricsService = new LyricsService();
