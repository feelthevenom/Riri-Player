import type {
  Track,
  YtMusicBrowseItem,
  YtMusicChip,
  YtMusicHomeSection,
  YtMusicNextResult,
} from '../../src/types/music';
import {
  NormalizedYtTrack,
  parseInnertubeBrowseCards,
  parseInnertubeHomeFeed,
  parseInnertubeNext,
  parseInnertubeSearchItems,
  parseInnertubeSearchSuggestions,
  parseInnertubeRichSearchSuggestions,
} from '../../src/utils/ytMusicParser';
import { innerTubePost } from './innertube';

// ArchiveTune InnerTube Search Filter Params
export const SEARCH_FILTER_PARAMS: Record<string, string> = {
  all: '',
  songs: 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D',
  videos: 'EgWKAQIQAWoKEAMQBBAJEAoQBQ%3D%3D',
  albums: 'EgWKAQIYAWoKEAMQBBAJEAoQBQ%3D%3D',
  artists: 'EgWKAQIgAWoKEAMQBBAJEAoQBQ%3D%3D',
  playlists: 'EgeKAQQoAEABagoQAxAEEAkQChAF',
};

function toTrack(t: NormalizedYtTrack): Track {
  return {
    ...t,
    source: 'ytmusic',
  };
}

function extractContinuationToken(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  let token: string | undefined;
  const walk = (node: unknown, depth = 0) => {
    if (token || !node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.continuation === 'string' && obj.continuation.length > 8) {
      token = obj.continuation;
      return;
    }
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') walk(val, depth + 1);
    }
  };
  walk(json, 0);
  return token;
}

function extractWatchTabBrowseIds(json: unknown): {
  lyricsBrowseId?: string;
  relatedBrowseId?: string;
} {
  const result: { lyricsBrowseId?: string; relatedBrowseId?: string } = {};
  if (!json || typeof json !== 'object') return result;
  const tabs = (
    (
      (json as Record<string, unknown>).contents as Record<string, unknown> | undefined
    )?.singleColumnMusicWatchNextResultsRenderer as Record<string, unknown> | undefined
  )?.tabbedRenderer as Record<string, unknown> | undefined;
  const tabList = (
    tabs?.watchNextTabbedResultsRenderer as Record<string, unknown> | undefined
  )?.tabs as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(tabList)) return result;

  for (const t of tabList) {
    const tr = t.tabRenderer as Record<string, unknown> | undefined;
    if (!tr) continue;
    const title = String(tr.title || '').toLowerCase();
    const browseId = (
      (tr.endpoint as Record<string, unknown> | undefined)?.browseEndpoint as
        | Record<string, unknown>
        | undefined
    )?.browseId as string | undefined;
    if (!browseId) continue;
    if (title.includes('lyric') || browseId.startsWith('MPLYt')) {
      result.lyricsBrowseId = browseId;
    } else if (title.includes('related') || browseId.startsWith('MPTRt')) {
      result.relatedBrowseId = browseId;
    }
  }
  return result;
}

export async function fetchHomeFeed(opts: {
  params?: string;
  continuation?: string;
  gl?: string;
  hl?: string;
}): Promise<{
  sections: YtMusicHomeSection[];
  chips: YtMusicChip[];
  tracks: Track[];
  continuation?: string;
}> {
  const body: Record<string, unknown> = opts.continuation
    ? { continuation: opts.continuation }
    : {
        browseId: 'FEmusic_home',
        ...(opts.params ? { params: opts.params } : {}),
      };

  const json = await innerTubePost({
    endpoint: 'browse',
    body,
    gl: opts.gl || 'US',
    hl: opts.hl || 'en',
  });

  const parsed = parseInnertubeHomeFeed(json);
  const continuation = extractContinuationToken(json);

  return {
    sections: parsed.sections.map((sec) => ({
      id: sec.id,
      title: sec.title,
      items: sec.items.map((item) => ({
        ...item,
        track: item.track ? toTrack(item.track) : undefined,
      })),
    })),
    chips: parsed.chips,
    tracks: parsed.tracks.map(toTrack),
    continuation,
  };
}

export async function fetchExploreCharts(opts: {
  gl?: string;
  hl?: string;
}): Promise<{
  tracks: Track[];
  sections: YtMusicHomeSection[];
}> {
  const gl = opts.gl || 'US';
  const hl = opts.hl || 'en';

  const [chartsJson, exploreJson] = await Promise.all([
    innerTubePost({
      endpoint: 'browse',
      body: { browseId: 'FEmusic_charts' },
      gl,
      hl,
    }).catch(() => null),
    innerTubePost({
      endpoint: 'browse',
      body: { browseId: 'FEmusic_explore' },
      gl,
      hl,
    }).catch(() => null),
  ]);

  const tracks: Track[] = [];
  const seen = new Set<string>();
  const sections: YtMusicHomeSection[] = [];

  for (const payload of [chartsJson, exploreJson]) {
    if (!payload) continue;
    const homeParsed = parseInnertubeHomeFeed(payload);
    for (const sec of homeParsed.sections) {
      sections.push({
        id: sec.id,
        title: sec.title,
        items: sec.items.map((item) => ({
          ...item,
          track: item.track ? toTrack(item.track) : undefined,
        })),
      });
    }
    for (const t of parseInnertubeSearchItems(payload)) {
      if (!seen.has(t.ytMusicVideoId)) {
        seen.add(t.ytMusicVideoId);
        tracks.push(toTrack(t));
      }
    }
    for (const t of homeParsed.tracks) {
      if (!seen.has(t.ytMusicVideoId)) {
        seen.add(t.ytMusicVideoId);
        tracks.push(toTrack(t));
      }
    }
  }

  return { tracks, sections };
}

export async function browseYtmCollection(opts: {
  browseId: string;
  continuation?: string;
  gl?: string;
  hl?: string;
}): Promise<{
  browseId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  tracks: Track[];
  items: YtMusicBrowseItem[];
  continuation?: string;
}> {
  let targetBrowseId = (opts.browseId || '').trim();
  if (
    targetBrowseId &&
    !opts.continuation &&
    !targetBrowseId.startsWith('VL') &&
    !targetBrowseId.startsWith('UC') &&
    !targetBrowseId.startsWith('MPRE') &&
    !targetBrowseId.startsWith('FE') &&
    !targetBrowseId.startsWith('MP') &&
    /^(PL|OLAK5uy_|RDCLAK5uy_|UU|LL|FL)/.test(targetBrowseId)
  ) {
    targetBrowseId = `VL${targetBrowseId}`;
  }

  const json = await innerTubePost({
    endpoint: 'browse',
    body: opts.continuation
      ? { continuation: opts.continuation }
      : { browseId: targetBrowseId },
    gl: opts.gl || 'US',
    hl: opts.hl || 'en',
  });

  const tracks = parseInnertubeSearchItems(json).map(toTrack);
  const cards = parseInnertubeBrowseCards(json, 'song');
  const items: YtMusicBrowseItem[] = cards.map((c) => ({
    ...c,
    track: c.track ? toTrack(c.track) : undefined,
  }));

  let title = '';
  let subtitle = '';
  let thumbnailUrl = '';

  const header = (json.header as Record<string, unknown> | undefined) || {};
  const detailHeader =
    (header.musicDetailHeaderRenderer as Record<string, unknown> | undefined) ||
    (header.musicResponsiveHeaderRenderer as Record<string, unknown> | undefined) ||
    (header.musicImmersiveHeaderRenderer as Record<string, unknown> | undefined) ||
    (header.musicEditablePlaylistDetailHeaderRenderer as {
      header?: { musicResponsiveHeaderRenderer?: Record<string, unknown> };
    } | undefined)?.header?.musicResponsiveHeaderRenderer;

  if (detailHeader) {
    const titleRuns = (detailHeader.title as { runs?: Array<{ text?: string }> } | undefined)?.runs;
    title = (titleRuns || []).map((r) => r.text || '').join('').trim();
    const subRuns = (detailHeader.subtitle as { runs?: Array<{ text?: string }> } | undefined)?.runs;
    subtitle = (subRuns || []).map((r) => r.text || '').join('').trim();
    const thumbs =
      (
        (detailHeader.thumbnail as Record<string, unknown> | undefined)?.croppedSquareThumbnailRenderer as
          | { thumbnail?: { thumbnails?: Array<{ url?: string }> } }
          | undefined
      )?.thumbnail?.thumbnails ||
      (
        (detailHeader.thumbnail as Record<string, unknown> | undefined)?.musicThumbnailRenderer as
          | { thumbnail?: { thumbnails?: Array<{ url?: string }> } }
          | undefined
      )?.thumbnail?.thumbnails ||
      [];
    const rawThumb = thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || '';
    if (rawThumb) {
      thumbnailUrl = `/api/proxy-image?url=${encodeURIComponent(rawThumb)}`;
    }
  }

  return {
    browseId: targetBrowseId,
    title: title || tracks[0]?.album || 'YouTube Music Collection',
    subtitle: subtitle || `${tracks.length} tracks`,
    thumbnailUrl: thumbnailUrl || tracks[0]?.thumbnailUrl || '',
    tracks,
    items,
    continuation: extractContinuationToken(json),
  };
}

export async function searchYtm(opts: {
  query: string;
  filter?: string;
  continuation?: string;
  gl?: string;
  hl?: string;
}): Promise<{
  tracks: Track[];
  cards: YtMusicBrowseItem[];
  continuation?: string;
}> {
  const q = (opts.query || '').trim();
  if (!q && !opts.continuation) {
    return { tracks: [], cards: [] };
  }

  const filterKey = (opts.filter || 'songs').toLowerCase();
  const filterParam = SEARCH_FILTER_PARAMS[filterKey] || '';

  const body: Record<string, unknown> = opts.continuation
    ? { continuation: opts.continuation }
    : {
        query: q,
        ...(filterParam ? { params: decodeURIComponent(filterParam) } : {}),
      };

  const json = await innerTubePost({
    endpoint: 'search',
    body,
    gl: opts.gl || 'US',
    hl: opts.hl || 'en',
  });

  let tracks = parseInnertubeSearchItems(json).map(toTrack);
  const cards = parseInnertubeBrowseCards(
    json,
    filterKey === 'albums'
      ? 'album'
      : filterKey === 'artists'
        ? 'artist'
        : filterKey === 'playlists'
          ? 'playlist'
          : 'song',
  ).map((c) => ({
    ...c,
    track: c.track ? toTrack(c.track) : undefined,
  }));

  if (tracks.length === 0 && (filterKey === 'songs' || filterKey === 'all')) {
    const cardTracks = cards.map((c) => c.track).filter((t): t is Track => Boolean(t));
    if (cardTracks.length > 0) tracks = cardTracks;
  }

  return {
    tracks,
    cards,
    continuation: extractContinuationToken(json),
  };
}

export async function fetchYtmSearchSuggestions(opts: {
  query: string;
  gl?: string;
  hl?: string;
}): Promise<{ queries: string[]; items: YtMusicBrowseItem[] }> {
  const q = (opts.query || '').trim();
  if (!q) return { queries: [], items: [] };
  try {
    const json = await innerTubePost({
      endpoint: 'music/get_search_suggestions',
      body: { input: q },
      gl: opts.gl || 'US',
      hl: opts.hl || 'en',
    });
    const rich = parseInnertubeRichSearchSuggestions(json);
    return {
      queries: rich.queries,
      items: rich.items.map((c) => ({
        ...c,
        track: c.track ? toTrack(c.track) : undefined,
      })),
    };
  } catch {
    return { queries: [], items: [] };
  }
}

export async function fetchNextQueue(opts: {
  videoId?: string;
  playlistId?: string;
  params?: string;
  continuation?: string;
  gl?: string;
  hl?: string;
}): Promise<YtMusicNextResult | null> {
  const body: Record<string, unknown> = opts.continuation
    ? { continuation: opts.continuation }
    : {
        isAudioOnly: true,
        enablePersistentPlaylistPanel: true,
        tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
        ...(opts.videoId ? { videoId: opts.videoId } : {}),
        playlistId:
          opts.playlistId || (opts.videoId ? `RDAMVM${opts.videoId}` : undefined),
        ...(opts.params ? { params: opts.params } : {}),
      };

  const json = await innerTubePost({
    endpoint: 'next',
    body,
    gl: opts.gl || 'US',
    hl: opts.hl || 'en',
  });

  const parsed = parseInnertubeNext(json);
  if (!parsed) return null;
  const tabIds = extractWatchTabBrowseIds(json);

  return {
    title: parsed.title,
    items: parsed.items.map(toTrack),
    currentIndex: parsed.currentIndex,
    continuation: parsed.continuation,
    lyricsBrowseId: tabIds.lyricsBrowseId,
    relatedBrowseId: tabIds.relatedBrowseId,
    endpoint: parsed.endpoint,
    automixEndpoint: parsed.automixEndpoint,
    queueChips: parsed.queueChips,
  };
}

export async function fetchYtmLyrics(opts: {
  videoId: string;
  lyricsBrowseId?: string;
  gl?: string;
  hl?: string;
}): Promise<{ plainLyrics?: string; source?: string }> {
  const gl = opts.gl || 'US';
  const hl = opts.hl || 'en';
  let browseId = opts.lyricsBrowseId;
  if (!browseId && opts.videoId) {
    const nextRes = await fetchNextQueue({ videoId: opts.videoId, gl, hl }).catch(() => null);
    browseId = nextRes?.lyricsBrowseId;
  }
  if (!browseId) return {};

  try {
    const json = await innerTubePost({
      endpoint: 'browse',
      body: { browseId },
      gl,
      hl,
    });
    let text = '';
    const walk = (node: unknown, depth = 0) => {
      if (text || !node || typeof node !== 'object' || depth > 14) return;
      if (Array.isArray(node)) {
        for (const el of node) walk(el, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;
      const desc = obj.musicDescriptionShelfRenderer as
        | { description?: { runs?: Array<{ text?: string }> }; footer?: { runs?: Array<{ text?: string }> } }
        | undefined;
      if (desc?.description?.runs) {
        text = desc.description.runs.map((r) => r.text || '').join('').trim();
        return;
      }
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') walk(val, depth + 1);
      }
    };
    walk(json, 0);
    return text ? { plainLyrics: text, source: 'YouTube Music' } : {};
  } catch {
    return {};
  }
}
