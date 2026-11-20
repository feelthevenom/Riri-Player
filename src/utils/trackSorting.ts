import { PlayEvent, StatPeriod, Track } from '../types/music';

export type SortColumn = 'index' | 'title' | 'artist' | 'album' | 'duration';
export type SortDirection = 'asc' | 'desc';

export function sortTracks(
  tracks: Track[],
  column: SortColumn,
  direction: SortDirection,
): Track[] {
  if (column === 'index') {
    return direction === 'asc' ? [...tracks] : [...tracks].reverse();
  }
  const factor = direction === 'asc' ? 1 : -1;
  return [...tracks].sort((a, b) => {
    switch (column) {
      case 'title':
        return a.title.localeCompare(b.title) * factor;
      case 'artist':
        return a.artist.localeCompare(b.artist) * factor;
      case 'album':
        return a.album.localeCompare(b.album) * factor;
      case 'duration':
        return ((a.durationSec || 0) - (b.durationSec || 0)) * factor;
      default:
        return 0;
    }
  });
}

export function extractSpotifyPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]+)$/);
  if (uriMatch) return uriMatch[1];
  try {
    const url = new URL(trimmed);
    if (!url.hostname.includes('spotify.com')) return null;
    const match = url.pathname.match(/\/playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function computeListeningStats(events: PlayEvent[], period: StatPeriod, nowMs = Date.now()) {
  const periodMsMap: Record<StatPeriod, number> = {
    WEEK_1: 7 * 86400_000,
    MONTH_1: 30 * 86400_000,
    MONTH_3: 90 * 86400_000,
    MONTH_6: 180 * 86400_000,
    YEAR_1: 365 * 86400_000,
    ALL: Infinity,
  };
  const windowMs = periodMsMap[period] ?? Infinity;
  const filtered =
    windowMs === Infinity ? events : events.filter((ev) => ev.timestamp >= nowMs - windowMs);

  const totalSec = filtered.reduce((sum, ev) => sum + (ev.durationPlayedSec || 0), 0);
  const totalMinutes = Math.round(totalSec / 60);

  const songMap = new Map<
    string,
    { trackId: string; title: string; artist: string; thumbnailUrl: string; plays: number; sec: number }
  >();
  const artistMap = new Map<string, { artist: string; plays: number; sec: number }>();
  const slots = [0, 0, 0, 0];

  for (const ev of filtered) {
    const existingSong = songMap.get(ev.trackId);
    if (existingSong) {
      existingSong.plays += 1;
      existingSong.sec += ev.durationPlayedSec || 0;
    } else {
      songMap.set(ev.trackId, {
        trackId: ev.trackId,
        title: ev.title,
        artist: ev.artist,
        thumbnailUrl: ev.thumbnailUrl,
        plays: 1,
        sec: ev.durationPlayedSec || 0,
      });
    }

    const existingArtist = artistMap.get(ev.artist);
    if (existingArtist) {
      existingArtist.plays += 1;
      existingArtist.sec += ev.durationPlayedSec || 0;
    } else {
      artistMap.set(ev.artist, {
        artist: ev.artist,
        plays: 1,
        sec: ev.durationPlayedSec || 0,
      });
    }

    const hr = new Date(ev.timestamp).getHours();
    slots[Math.min(3, Math.floor(hr / 6))] += 1;
  }

  return {
    filteredCount: filtered.length,
    totalMinutes,
    uniqueTracks: songMap.size,
    topSongs: Array.from(songMap.values()).sort((a, b) => b.plays - a.plays),
    topArtists: Array.from(artistMap.values()).sort((a, b) => b.plays - a.plays),
    slots,
  };
}
