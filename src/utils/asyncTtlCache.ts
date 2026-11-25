export type AsyncCacheStatus = 'hit' | 'coalesced' | 'miss';

export interface AsyncTtlCacheEntry<T> {
  value: T;
  status: AsyncCacheStatus;
}

interface AsyncCacheRequest<T> {
  promise: Promise<T>;
  generation: number;
  forceRefresh: boolean;
}

/**
 * A small async cache with response TTLs and in-flight request coalescing.
 * It is used by server-side provider lookups so concurrent renderer requests
 * share one network operation instead of multiplying provider traffic.
 *
 * A forced refresh replaces an older non-forced request. Generations ensure
 * the older request can still serve its original caller but can never
 * overwrite the newer refreshed cache entry.
 */
export class AsyncTtlCache<T> {
  private readonly values = new Map<string, { expiresAt: number; value: T }>();
  private readonly requests = new Map<string, AsyncCacheRequest<T>>();
  private readonly generations = new Map<string, number>();
  private readonly revisions = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get size(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
    this.requests.clear();
    this.generations.clear();
    this.revisions.clear();
  }

  set(
    key: string,
    value: T,
    ttlMs: number | ((value: T) => number),
    expectedGeneration?: number,
  ): boolean {
    const currentGeneration = this.generations.get(key) || 0;
    if (
      expectedGeneration !== undefined &&
      currentGeneration !== expectedGeneration
    ) {
      return false;
    }
    const ttl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
    if (expectedGeneration === undefined) {
      this.generations.set(key, currentGeneration + 1);
    }
    this.revisions.set(key, (this.revisions.get(key) || 0) + 1);
    this.values.set(key, {
      expiresAt: this.now() + ttl,
      value,
    });
    return true;
  }

  async resolve(
    key: string,
    ttlMs: number | ((value: T) => number),
    factory: (generation: number) => Promise<T>,
    options?: { forceRefresh?: boolean },
  ): Promise<AsyncTtlCacheEntry<T>> {
    const now = this.now();
    const cached = this.values.get(key);
    if (!options?.forceRefresh && cached && cached.expiresAt > now) {
      return { value: cached.value, status: 'hit' };
    }
    if (cached) this.values.delete(key);

    const pending = this.requests.get(key);
    if (pending && (!options?.forceRefresh || pending.forceRefresh)) {
      return { value: await pending.promise, status: 'coalesced' };
    }

    const generation = (this.generations.get(key) || 0) + 1;
    this.generations.set(key, generation);
    const revision = this.revisions.get(key) || 0;
    const request: AsyncCacheRequest<T> = {
      generation,
      forceRefresh: Boolean(options?.forceRefresh),
      promise: Promise.resolve().then(() => factory(generation)),
    };
    this.requests.set(key, request);

    try {
      const value = await request.promise;
      if (
        this.generations.get(key) === generation &&
        (this.revisions.get(key) || 0) === revision
      ) {
        const ttl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
        this.values.set(key, {
          expiresAt: this.now() + ttl,
          value,
        });
      }
      return { value, status: 'miss' };
    } finally {
      if (this.requests.get(key) === request) {
        this.requests.delete(key);
      }
    }
  }
}
