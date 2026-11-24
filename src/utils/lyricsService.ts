/**
 * Lyrics Service - Multi-provider lyrics fetching with transliteration support
 * Inspired by ArchiveTune's lyrics architecture
 */

import { Track } from '../types/music';
import { transliterateLyrics, hasNonLatinScript, detectScript } from './transliterate';

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResult {
  ok: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  source: string;
  provider: string;
}

interface ParsedLyricLine {
  timeMs: number;
  text: string;
}

const LRC_LINE_REGEX = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

/**
 * Parse LRC formatted lyrics into structured lines
 */
export function parseLrcLyrics(lrc?: string | null): ParsedLyricLine[] {
  if (!lrc) return [];
  const lines: ParsedLyricLine[] = [];

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

/**
 * Find the active lyric line index based on current position
 */
export function findActiveLyricIndex(
  lines: ParsedLyricLine[],
  positionMs: number,
  offsetMs = 0
): number {
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

/**
 * Format time in MM:SS format
 */
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

/**
 * Lyrics service with multiple providers
 * Providers are tried in order of priority
 */
export class LyricsService {
  private providers: LyricsProvider[] = [];

  constructor() {
    // Register providers in priority order
    this.registerProvider(new LrclibProvider());
    this.registerProvider(new YtmLyricsProvider());
  }

  registerProvider(provider: LyricsProvider): void {
    this.providers.push(provider);
  }

  async fetchLyrics(payload: {
    title: string;
    artist: string;
    videoId?: string;
    lyricsBrowseId?: string;
    gl?: string;
    hl?: string;
  }): Promise<LyricsResult> {
    // Try each provider in order
    for (const provider of this.providers) {
      try {
        const result = await provider.fetchLyrics(payload);
        if (result.ok && (result.syncedLyrics || result.plainLyrics)) {
          return result;
        }
      } catch {
        // Try next provider
      }
    }

    return { ok: false, syncedLyrics: null, plainLyrics: null, source: '', provider: 'none' };
  }
}

/**
 * Base interface for lyrics providers
 */
interface LyricsProvider {
  fetchLyrics(payload: {
    title: string;
    artist: string;
    videoId?: string;
    lyricsBrowseId?: string;
    gl?: string;
    hl?: string;
  }): Promise<LyricsResult>;
}

/**
 * LRCLib provider - Free, open lyrics database
 */
class LrclibProvider implements LyricsProvider {
  async fetchLyrics(payload: {
    title: string;
    artist: string;
    videoId?: string;
    lyricsBrowseId?: string;
    gl?: string;
    hl?: string;
  }): Promise<LyricsResult> {
    try {
      const url = new URL('https://lrclib.net/api/get');
      url.searchParams.set('track_name', payload.title);
      url.searchParams.set('artist_name', payload.artist);

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'RiriPlayer/1.0' },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        return { ok: false, syncedLyrics: null, plainLyrics: null, source: 'LRCLIB', provider: 'lrclib' };
      }

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
      // Fall through to next provider
    }

    return { ok: false, syncedLyrics: null, plainLyrics: null, source: 'LRCLIB', provider: 'lrclib' };
  }
}

/**
 * YouTube Music lyrics provider - Fallback when LRCLIB fails
 */
class YtmLyricsProvider implements LyricsProvider {
  async fetchLyrics(payload: {
    title: string;
    artist: string;
    videoId?: string;
    lyricsBrowseId?: string;
    gl?: string;
    hl?: string;
  }): Promise<LyricsResult> {
    try {
      const qs = new URLSearchParams({
        title: payload.title,
        artist: payload.artist,
        gl: payload.gl || 'US',
        hl: payload.hl || 'en',
      });
      if (payload.videoId) qs.set('videoId', payload.videoId);
      if (payload.lyricsBrowseId) qs.set('lyricsBrowseId', payload.lyricsBrowseId);

      const res = await fetch(`/api/lyrics?${qs.toString()}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return { ok: false, syncedLyrics: null, plainLyrics: null, source: 'YouTube Music', provider: 'ytm' };
      }

      const data = (await res.json()) as {
        syncedLyrics?: string;
        plainLyrics?: string;
        source?: string;
      };

      if (data.syncedLyrics || data.plainLyrics) {
        return {
          ok: true,
          syncedLyrics: data.syncedLyrics || null,
          plainLyrics: data.plainLyrics || null,
          source: data.source || 'YouTube Music',
          provider: 'ytm',
        };
      }
    } catch {
      // Fall through
    }

    return { ok: false, syncedLyrics: null, plainLyrics: null, source: 'YouTube Music', provider: 'ytm' };
  }
}

export const lyricsService = new LyricsService();