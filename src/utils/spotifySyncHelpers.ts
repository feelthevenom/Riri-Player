import { SpotifySyncSchedule } from '../types/music';

const DAY_MS = 24 * 60 * 60 * 1000;

export function getSpotifySyncIntervalMs(schedule: SpotifySyncSchedule): number | null {
  switch (schedule) {
    case 'DAILY':
      return DAY_MS;
    case 'WEEKLY':
      return 7 * DAY_MS;
    case 'YEARLY':
      return 365 * DAY_MS;
    case 'MANUAL':
    default:
      return null;
  }
}

export function isSpotifyAutoSyncDue(
  schedule: SpotifySyncSchedule,
  lastSyncedAt: number | undefined,
  nowMs = Date.now(),
): boolean {
  const interval = getSpotifySyncIntervalMs(schedule);
  if (interval === null) return false;
  if (!lastSyncedAt || lastSyncedAt <= 0) return true;
  return nowMs - lastSyncedAt >= interval;
}

export function formatSpotifyScheduleLabel(schedule: SpotifySyncSchedule): string {
  switch (schedule) {
    case 'DAILY':
      return 'Every Day';
    case 'WEEKLY':
      return 'Every Week';
    case 'YEARLY':
      return 'Every Year';
    case 'MANUAL':
    default:
      return 'Manual Only';
  }
}
