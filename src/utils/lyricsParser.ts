import { LyricLine } from '../types/music';

const LRC_LINE_REGEX = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

export function parseLrcLyrics(lrc?: string | null): LyricLine[] {
  if (!lrc) return [];
  const lines: LyricLine[] = [];

  for (const rawLine of lrc.split('\n')) {
    const matches = [...rawLine.matchAll(LRC_LINE_REGEX)];
    if (matches.length === 0) continue;
    const text = rawLine.replace(LRC_LINE_REGEX, '').trim();
    if (!text) continue;

    for (const m of matches) {
      const mins = parseInt(m[1], 10);
      const secs = parseInt(m[2], 10);
      const fracRaw = m[3] || '0';
      const fracMs =
        fracRaw.length === 1
          ? parseInt(fracRaw, 10) * 100
          : fracRaw.length === 2
            ? parseInt(fracRaw, 10) * 10
            : parseInt(fracRaw.slice(0, 3), 10);
      const timeMs = mins * 60_000 + secs * 1000 + fracMs;
      lines.push({ timeMs, text });
    }
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

export function findActiveLyricIndex(lines: LyricLine[], positionMs: number, offsetMs = 0): number {
  if (lines.length === 0) return -1;
  const adjusted = positionMs + offsetMs;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= adjusted) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
