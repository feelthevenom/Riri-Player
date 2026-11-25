export interface LyricsCandidate {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

export interface RankedLyricsTask<T> {
  promise: Promise<T | null>;
  rank: number;
}

export type LyricsResolutionTask<T> = Promise<T | null> | RankedLyricsTask<T>;

export interface LyricsResolutionOptions<T> {
  plainGraceMs?: number;
  syncedGraceMs?: number;
  /** Returns the effective provider rank for a resolved candidate. */
  getPriority?: (result: T, fallbackRank: number) => number;
  /** Called when synchronized lyrics arrive after the initial result settled. */
  onLateUpgrade?: (result: T) => void;
}

export function hasUsableLyrics(
  result: LyricsCandidate | null | undefined,
): result is LyricsCandidate {
  return Boolean(result && (result.syncedLyrics || result.plainLyrics));
}

interface RankedCandidate<T> {
  result: T;
  rank: number;
  sequence: number;
}

/**
 * Resolves concurrent lyrics tasks without making the UI wait for a provider
 * that is already known to be slower. A synchronized result always wins. When
 * a plain-only result arrives first, a short grace period allows a concurrent
 * synchronized provider to replace it.
 *
 * Provider priority is explicit rather than arrival-order based: among
 * candidates with the same synchronization quality, the lowest configured
 * rank wins. Late synchronized candidates are surfaced only when they improve
 * on the selected rank, so a slower lower-priority provider cannot overwrite a
 * better result in a short-lived cache entry.
 */
export async function resolveFirstLyricsCandidate<T extends LyricsCandidate>(
  tasks: Array<LyricsResolutionTask<T>>,
  options?: LyricsResolutionOptions<T>,
): Promise<T | null> {
  if (tasks.length === 0) return null;

  const plainGraceMs = options?.plainGraceMs ?? 500;
  const syncedGraceMs = options?.syncedGraceMs ?? 100;
  return await new Promise<T | null>((resolve) => {
    let pending = tasks.length;
    let settled = false;
    let sequence = 0;
    let plainTimer: ReturnType<typeof setTimeout> | null = null;
    let syncedTimer: ReturnType<typeof setTimeout> | null = null;
    let settledPriority: number | null = null;
    const plainCandidates: RankedCandidate<T>[] = [];
    const syncedCandidates: RankedCandidate<T>[] = [];

    const best = (candidates: RankedCandidate<T>[]): RankedCandidate<T> | null => {
      if (candidates.length === 0) return null;
      return [...candidates].sort(
        (left, right) => left.rank - right.rank || left.sequence - right.sequence,
      )[0];
    };

    const settle = (candidate: RankedCandidate<T> | null): void => {
      if (settled) return;
      settled = true;
      // A plain-only result has no synchronized provider priority yet. Any
      // synchronized result may replace it, after which only a better-ranked
      // synchronized provider may replace that result.
      settledPriority = candidate?.result.syncedLyrics ? candidate.rank : null;
      if (plainTimer) clearTimeout(plainTimer);
      if (syncedTimer) clearTimeout(syncedTimer);
      resolve(candidate?.result ?? null);
    };

    const notifyLateUpgrade = (candidate: RankedCandidate<T>): void => {
      if (settledPriority !== null && candidate.rank >= settledPriority) return;
      settledPriority = candidate.rank;
      try {
        options?.onLateUpgrade?.(candidate.result);
      } catch {
        // Cache upgrades must never break the original lyrics request.
      }
    };

    for (const task of tasks) {
      const normalized =
        task && typeof task === 'object' && 'promise' in task
          ? (task as RankedLyricsTask<T>)
          : { promise: task as Promise<T | null>, rank: 0 };

      void normalized.promise
        .then((result) => {
          if (!hasUsableLyrics(result)) return;
          const candidate: RankedCandidate<T> = {
            result: result as T,
            rank: Math.max(
              0,
              options?.getPriority?.(result as T, normalized.rank) ?? normalized.rank,
            ),
            sequence: sequence++,
          };

          if (candidate.result.syncedLyrics) {
            if (settled) {
              notifyLateUpgrade(candidate);
              return;
            }
            syncedCandidates.push(candidate);
            if (candidate.rank === 0) {
              settle(candidate);
              return;
            }
            if (!syncedTimer) {
              syncedTimer = setTimeout(() => settle(best(syncedCandidates)), syncedGraceMs);
            }
            return;
          }

          if (settled) return;
          plainCandidates.push(candidate);
          if (!plainTimer) {
            plainTimer = setTimeout(() => settle(best(plainCandidates)), plainGraceMs);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          pending -= 1;
          if (pending === 0 && !settled) {
            settle(best(syncedCandidates) || best(plainCandidates));
          }
        });
    }
  });
}
