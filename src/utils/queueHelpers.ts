import { Track } from '../types/music';

/**
 * Appends YouTube Music radio suggestions to an existing queue without duplicating tracks.
 */
export function appendUniqueQueueSuggestions(existingQueue: Track[], incoming: Track[]): Track[] {
  if (!incoming || incoming.length === 0) return existingQueue;
  const seenIds = new Set<string>(existingQueue.map((t) => t.id));
  const seenVideoIds = new Set<string>(
    existingQueue.map((t) => t.ytMusicVideoId).filter((v): v is string => Boolean(v)),
  );

  const additions: Track[] = [];
  for (const item of incoming) {
    if (seenIds.has(item.id)) continue;
    if (item.ytMusicVideoId && seenVideoIds.has(item.ytMusicVideoId)) continue;
    seenIds.add(item.id);
    if (item.ytMusicVideoId) seenVideoIds.add(item.ytMusicVideoId);
    additions.push(item);
  }

  if (additions.length === 0) return existingQueue;
  return [...existingQueue, ...additions];
}

export interface PlayQueueModeOptions {
  unlimited?: boolean;
  preserveQueueMode?: boolean;
}

/**
 * Determines whether playback should use unlimited YouTube Music radio suggestions
 * (true for non-playlist/non-library single-track or home-shelf playback) or stay
 * strictly bounded to the selected playlist/library queue (false).
 */
export function shouldUseUnlimitedQueue(
  hasExplicitQueue: boolean,
  options?: PlayQueueModeOptions,
  currentUnlimited = true,
): boolean {
  if (options?.preserveQueueMode) return currentUnlimited;
  if (typeof options?.unlimited === 'boolean') return options.unlimited;
  return !hasExplicitQueue;
}

/**
 * Replaces the upcoming portion of the queue after `activeIndex` with newly filtered radio tracks
 * (used when selecting a YT Music Queue Chip like "Familiar" or "Discover").
 */
export function replaceUpcomingQueueWithRadio(
  existingQueue: Track[],
  activeIndex: number,
  radioItems: Track[],
): Track[] {
  const safeIdx = Math.max(0, Math.min(activeIndex, Math.max(0, existingQueue.length - 1)));
  const head = existingQueue.length > 0 ? existingQueue.slice(0, safeIdx + 1) : [];
  return appendUniqueQueueSuggestions(head, radioItems);
}
