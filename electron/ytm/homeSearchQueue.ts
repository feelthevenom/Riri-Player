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
  pickBestThumbnailUrl,
} from '../../src/utils/ytMusicParser';
import { extractYtMusicContinuation } from '../../src/utils/ytmContinuation';
import { getActiveYtAccount } from './credentials';
import { hasYouTubeLoginCookie } from './clients';
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

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('YouTube Music request aborted');
  error.name = 'AbortError';
  throw error;
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

  const active = await getActiveYtAccount();
  const requireAuth = Boolean(active && hasYouTubeLoginCookie(active.cookie));
  const json = await innerTubePost({
    endpoint: 'browse',
    body,
    gl: opts.gl || 'US',
    hl: opts.hl || 'en',
    requireAuth,
    accountOverride: active || undefined,
  });

  const parsed = parseInnertubeHomeFeed(json);
  const continuation = extractYtMusicContinuation(json);

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

function readRendererText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const renderer = value as {
    runs?: Array<{ text?: string }>;
    simpleText?: string;
  };
  if (Array.isArray(renderer.runs)) {
    return renderer.runs.map((run) => run.text || '').join('').trim();
  }
  return (renderer.simpleText || '').trim();
}

function findCollectionHeader(json: unknown): Record<string, unknown> | undefined {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const topHeader = (root.header as Record<string, unknown> | undefined) || {};

  const preferred =
    (topHeader.musicDetailHeaderRenderer as Record<string, unknown> | undefined) ||
    (topHeader.musicResponsiveHeaderRenderer as Record<string, unknown> | undefined) ||
    (topHeader.musicImmersiveHeaderRenderer as Record<string, unknown> | undefined) ||
    (
      topHeader.musicEditablePlaylistDetailHeaderRenderer as
        | { header?: { musicResponsiveHeaderRenderer?: Record<string, unknown> } }
        | undefined
    )?.header?.musicResponsiveHeaderRenderer;
  if (preferred) return preferred;

  let found: Record<string, unknown> | undefined;
  const walk = (node: unknown, depth = 0): void => {
    if (found || !node || typeof node !== 'object' || depth > 18) return;
    if (Array.isArray(node)) {
      for (const element of node) walk(element, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const candidate =
      (obj.musicDetailHeaderRenderer as Record<string, unknown> | undefined) ||
      (obj.musicResponsiveHeaderRenderer as Record<string, unknown> | undefined) ||
      (obj.musicImmersiveHeaderRenderer as Record<string, unknown> | undefined) ||
      (
        obj.musicEditablePlaylistDetailHeaderRenderer as
          | { header?: { musicResponsiveHeaderRenderer?: Record<string, unknown> } }
          | undefined
      )?.header?.musicResponsiveHeaderRenderer;
    if (candidate) {
      found = candidate;
      return;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  };
  walk(json, 0);
  return found;
}

function getCollectionHeaderThumbnail(header: Record<string, unknown> | undefined): string {
  if (!header) return '';
  const thumbnail = header.thumbnail as Record<string, unknown> | undefined;
  const renderer =
    (thumbnail?.croppedSquareThumbnailRenderer as Record<string, unknown> | undefined) ||
    (thumbnail?.musicThumbnailRenderer as Record<string, unknown> | undefined) ||
    thumbnail;
  if (!renderer) return '';
  const thumbs =
    (renderer.thumbnail as { thumbnails?: Array<{ url?: string; width?: number; height?: number }> } | undefined)?.thumbnails ||
    (renderer.thumbnails as Array<{ url?: string; width?: number; height?: number }> | undefined) ||
    [];
  const rawThumb = pickBestThumbnailUrl(thumbs);
  return rawThumb ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : '';
}

export function parseYtmCollectionResponse(
  json: unknown,
  browseId: string,
): {
  browseId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  tracks: Track[];
  items: YtMusicBrowseItem[];
  continuation?: string;
} {
  const parsedTracks = parseInnertubeSearchItems(json).map(toTrack);
  const cards = parseInnertubeBrowseCards(json, 'song');
  const items: YtMusicBrowseItem[] = cards.map((card) => ({
    ...card,
    track: card.track ? toTrack(card.track) : undefined,
  }));

  const detailHeader = findCollectionHeader(json);
  const title = detailHeader ? readRendererText(detailHeader.title) : '';
  const subtitle = detailHeader
    ? readRendererText(detailHeader.subtitle) || readRendererText(detailHeader.straplineTextOne)
    : '';
  let thumbnailUrl = getCollectionHeaderThumbnail(detailHeader);

  if (!thumbnailUrl) {
    const matchingCard = items.find(
      (item) => item.title.trim().toLowerCase() === title.trim().toLowerCase() && item.thumbnailUrl,
    );
    thumbnailUrl = matchingCard?.thumbnailUrl || items.find((item) => item.thumbnailUrl)?.thumbnailUrl || '';
  }

  const isAlbum = browseId.startsWith('MPRE');
  const tracks = parsedTracks.map((track) => ({
    ...track,
    thumbnailUrl: track.thumbnailUrl || thumbnailUrl,
    // The collection header is authoritative for album metadata. Individual
    // rows can expose an artist/other column as a misleading album name.
    album: isAlbum && title ? title : track.album,
    albumId: isAlbum ? browseId : track.albumId,
  }));
  const collectionItems = items.map((item) => ({
    ...item,
    thumbnailUrl: item.thumbnailUrl || thumbnailUrl,
    track: item.track
      ? {
          ...item.track,
          thumbnailUrl: item.track.thumbnailUrl || thumbnailUrl,
          album: isAlbum && title ? title : item.track.album,
          albumId: isAlbum ? browseId : item.track.albumId,
        }
      : undefined,
  }));

  return {
    browseId,
    title: title || tracks[0]?.album || 'YouTube Music Collection',
    subtitle: subtitle || `${tracks.length} tracks`,
    thumbnailUrl: thumbnailUrl || tracks[0]?.thumbnailUrl || '',
    tracks,
    items: collectionItems,
    continuation: extractYtMusicContinuation(json, { itemShelfOnly: true }),
  };
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

  const active = await getActiveYtAccount();
  const requireAuth = Boolean(active && hasYouTubeLoginCookie(active.cookie));
  const json = await innerTubePost({
    endpoint: 'browse',
    body: opts.continuation
      ? { continuation: opts.continuation }
      : { browseId: targetBrowseId },
    gl: opts.gl || 'US',
    hl: opts.hl || 'en',
    requireAuth,
    accountOverride: active || undefined,
  });

  return parseYtmCollectionResponse(json, targetBrowseId);
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
    continuation: extractYtMusicContinuation(json),
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
  signal?: AbortSignal;
}): Promise<YtMusicNextResult | null> {
  throwIfAborted(opts.signal);
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
  throwIfAborted(opts.signal);

  const parsed = parseInnertubeNext(json);
  if (!parsed) return null;
  const tabIds = extractWatchTabBrowseIds(json);

  return {
    title: parsed.title,
    items: parsed.items.map(toTrack),
    currentIndex: parsed.currentIndex,
    continuation: parsed.continuation,
    lyricsBrowseId: tabIds.lyricsBrowseId,
    sourceVideoId: opts.videoId || parsed.endpoint.watchEndpoint.videoId,
    relatedBrowseId: tabIds.relatedBrowseId,
    endpoint: parsed.endpoint,
    automixEndpoint: parsed.automixEndpoint,
    queueChips: parsed.queueChips,
  };
}

export function selectMatchingLyricsBrowseId(
  videoId: string,
  lyricsBrowseId?: string,
  lyricsBrowseVideoId?: string,
): string | undefined {
  if (!lyricsBrowseId) return undefined;
  return lyricsBrowseVideoId === videoId ? lyricsBrowseId : undefined;
}

export async function fetchYtmLyrics(opts: {
  videoId: string;
  lyricsBrowseId?: string;
  lyricsBrowseVideoId?: string;
  gl?: string;
  hl?: string;
  signal?: AbortSignal;
}): Promise<{ plainLyrics?: string; source?: string }> {
  throwIfAborted(opts.signal);
  const gl = opts.gl || 'US';
  const hl = opts.hl || 'en';
  let browseId = selectMatchingLyricsBrowseId(
    opts.videoId,
    opts.lyricsBrowseId,
    opts.lyricsBrowseVideoId,
  );
  if (!browseId && opts.videoId) {
    const nextRes = await fetchNextQueue({
      videoId: opts.videoId,
      gl,
      hl,
      signal: opts.signal,
    }).catch(() => null);
    throwIfAborted(opts.signal);
    browseId = selectMatchingLyricsBrowseId(
      opts.videoId,
      nextRes?.lyricsBrowseId,
      nextRes?.sourceVideoId,
    );
  }
  if (!browseId) return {};

  try {
    const json = await innerTubePost({
      endpoint: 'browse',
      body: { browseId },
      gl,
      hl,
    });
    throwIfAborted(opts.signal);
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
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    return {};
  }
}
