export interface NormalizedYtTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  durationSec: number;
  thumbnailUrl: string;
  streamUrl: string;
  ytMusicVideoId: string;
  genre: string;
  qualityLabel: string;
  source: 'ytmusic';
}

export interface ParsedYtBrowseCard {
  id: string;
  kind: 'playlist' | 'album' | 'artist' | 'song' | 'video';
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  browseId?: string;
  videoId?: string;
  params?: string;
  track?: NormalizedYtTrack;
}

export interface ParsedYtHomeSection {
  id: string;
  title: string;
  items: ParsedYtBrowseCard[];
}

export interface ParsedYtChip {
  title: string;
  browseId: string;
  params?: string;
}

export interface YtMusicQueueChip {
  id: string;
  title: string;
  selected: boolean;
  endpoint: {
    watchEndpoint: {
      videoId?: string;
      playlistId?: string;
      params?: string;
    };
  };
  deselectEndpoint?: {
    watchEndpoint: {
      videoId?: string;
      playlistId?: string;
      params?: string;
    };
  };
}

export interface YtMusicNextResult {
  title?: string;
  items: NormalizedYtTrack[];
  currentIndex?: number;
  continuation?: string;
  endpoint: {
    watchEndpoint: {
      videoId?: string;
      playlistId?: string;
      params?: string;
    };
  };
  automixEndpoint?: {
    videoId?: string;
    playlistId?: string;
    params?: string;
  };
  queueChips: YtMusicQueueChip[];
}

function extractContinuationToken(container: Record<string, unknown> | undefined): string | undefined {
  if (!container) return undefined;
  const continuations = container.continuations as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(continuations)) {
    for (const c of continuations) {
      const nextRadio = (c.nextRadioContinuationData as Record<string, unknown> | undefined)?.continuation;
      if (typeof nextRadio === 'string' && nextRadio) return nextRadio;
      const nextCont = (c.nextContinuationData as Record<string, unknown> | undefined)?.continuation;
      if (typeof nextCont === 'string' && nextCont) return nextCont;
      const reloadCont = (c.reloadContinuationData as Record<string, unknown> | undefined)?.continuation;
      if (typeof reloadCont === 'string' && reloadCont) return reloadCont;
    }
  }
  if (typeof container.continuation === 'string' && container.continuation) {
    return container.continuation;
  }
  return undefined;
}

function parseChipCloud(chipCloud: Record<string, unknown> | undefined): YtMusicQueueChip[] {
  if (!chipCloud) return [];
  const chips = chipCloud.chips as unknown[] | undefined;
  if (!Array.isArray(chips)) return [];
  const validChips: YtMusicQueueChip[] = [];
  for (let idx = 0; idx < chips.length; idx++) {
    const chipRenderer = chips[idx] as Record<string, unknown>;
    const chipChipRenderer = chipRenderer.chipCloudChipRenderer as Record<string, unknown> | undefined;
    if (!chipChipRenderer) continue;
    const textObj = chipChipRenderer.text as Record<string, unknown> | undefined;
    const runs = textObj?.runs as Array<Record<string, unknown>> | undefined;
    const chipTitle =
      (runs ? runs.map((r) => String(r.text || '')).join('').trim() : '') ||
      String(textObj?.simpleText || '').trim();
    if (!chipTitle) continue;
    const chipId =
      (chipChipRenderer.chipId as string) ||
      `chip-${idx}-${chipTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const chipSelected = Boolean(chipChipRenderer.selected);
    const navigationEndpoint = chipChipRenderer.navigationEndpoint as Record<string, unknown> | undefined;
    const watchEndpoint =
      (navigationEndpoint?.watchEndpoint as Record<string, unknown> | undefined) ||
      (navigationEndpoint?.queueUpdateCommand as Record<string, unknown> | undefined);
    const deselectEndpoint = chipChipRenderer.deselectEndpoint as Record<string, unknown> | undefined;
    const deselectWatchEndpoint = deselectEndpoint?.watchEndpoint as Record<string, unknown> | undefined;
    validChips.push({
      id: chipId,
      title: chipTitle,
      selected: chipSelected,
      endpoint: {
        watchEndpoint: {
          videoId: watchEndpoint?.videoId as string | undefined,
          playlistId: watchEndpoint?.playlistId as string | undefined,
          params: watchEndpoint?.params as string | undefined,
        },
      },
      deselectEndpoint: deselectWatchEndpoint
        ? {
            watchEndpoint: {
              videoId: deselectWatchEndpoint.videoId as string | undefined,
              playlistId: deselectWatchEndpoint.playlistId as string | undefined,
              params: deselectWatchEndpoint.params as string | undefined,
            },
          }
        : undefined,
    });
  }
  return validChips;
}

function parsePanelContents(panelItems: unknown[]): {
  items: NormalizedYtTrack[];
  automixEndpoint?: { videoId?: string; playlistId?: string; params?: string };
} {
  const items: NormalizedYtTrack[] = [];
  const seen = new Set<string>();
  let automixEndpoint: { videoId?: string; playlistId?: string; params?: string } | undefined;

  for (const item of panelItems) {
    if (!item || typeof item !== 'object') continue;
    const renderer = item as Record<string, unknown>;
    const videoRenderer = renderer.playlistPanelVideoRenderer as Record<string, unknown> | undefined;
    if (videoRenderer) {
      const track = parsePlaylistPanelVideoRenderer(videoRenderer);
      if (track && !seen.has(track.ytMusicVideoId)) {
        seen.add(track.ytMusicVideoId);
        items.push(track);
      }
      continue;
    }

    const wrapperRenderer = renderer.playlistPanelVideoWrapperRenderer as Record<string, unknown> | undefined;
    if (wrapperRenderer) {
      const primary = (wrapperRenderer.primaryRenderer as Record<string, unknown> | undefined)
        ?.playlistPanelVideoRenderer as Record<string, unknown> | undefined;
      if (primary) {
        const track = parsePlaylistPanelVideoRenderer(primary);
        if (track && !seen.has(track.ytMusicVideoId)) {
          seen.add(track.ytMusicVideoId);
          items.push(track);
        }
      }
      continue;
    }

    const automix = renderer.automixPreviewVideoRenderer as Record<string, unknown> | undefined;
    if (automix && !automixEndpoint) {
      const content = automix.content as Record<string, unknown> | undefined;
      const automixPl = content?.automixPlaylistVideoRenderer as Record<string, unknown> | undefined;
      const nav = automixPl?.navigationEndpoint as Record<string, unknown> | undefined;
      const watchPl =
        (nav?.watchPlaylistEndpoint as Record<string, unknown> | undefined) ||
        (nav?.watchEndpoint as Record<string, unknown> | undefined);
      if (watchPl?.playlistId) {
        automixEndpoint = {
          videoId: watchPl.videoId as string | undefined,
          playlistId: watchPl.playlistId as string,
          params: watchPl.params as string | undefined,
        };
      }
    }
  }

  return { items, automixEndpoint };
}

export function parseInnertubeNext(json: unknown): YtMusicNextResult | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;

  const continuationContents = obj.continuationContents as Record<string, unknown> | undefined;
  if (continuationContents?.playlistPanelContinuation) {
    const panelCont = continuationContents.playlistPanelContinuation as Record<string, unknown>;
    const contItems = (panelCont.contents as unknown[] | undefined) || [];
    const { items, automixEndpoint } = parsePanelContents(contItems);
    const continuation = extractContinuationToken(panelCont);
    return {
      items,
      continuation,
      automixEndpoint,
      endpoint: { watchEndpoint: {} },
      queueChips: [],
    };
  }

  const contents = obj.contents as Record<string, unknown> | undefined;
  if (!contents) return null;
  const singleColumn = contents.singleColumnMusicWatchNextResultsRenderer as Record<string, unknown> | undefined;
  if (!singleColumn) return null;
  const tabbed = singleColumn.tabbedRenderer as Record<string, unknown> | undefined;
  if (!tabbed) return null;
  const watchNext = tabbed.watchNextTabbedResultsRenderer as Record<string, unknown> | undefined;
  if (!watchNext) return null;
  const tabs = watchNext.tabs as unknown[] | undefined;
  if (!tabs || tabs.length === 0) return null;

  for (const tab of tabs) {
    const tabRenderer = tab as Record<string, unknown>;
    const tabContent = tabRenderer.tabRenderer as Record<string, unknown> | undefined;
    if (!tabContent) continue;
    const content = tabContent.content as Record<string, unknown> | undefined;
    if (!content) continue;

    const musicQueue = content.musicQueueRenderer as Record<string, unknown> | undefined;
    const playlistPanel =
      (content.playlistPanelRenderer as Record<string, unknown> | undefined) ||
      ((musicQueue?.content as Record<string, unknown> | undefined)?.playlistPanelRenderer as
        | Record<string, unknown>
        | undefined);

    if (!playlistPanel) continue;
    const playlistPanelItems = playlistPanel.contents as unknown[] | undefined;
    if (!Array.isArray(playlistPanelItems)) continue;

    const panelHeader = playlistPanel.header as Record<string, unknown> | undefined;
    const queueHeader = (musicQueue?.header as Record<string, unknown> | undefined)
      ?.musicQueueHeaderRenderer as Record<string, unknown> | undefined;
    const subHeaderChipCloud = (musicQueue?.subHeaderChipCloud as Record<string, unknown> | undefined)
      ?.chipCloudRenderer as Record<string, unknown> | undefined;
    const panelHeaderChipCloud = panelHeader?.chipCloudRenderer as Record<string, unknown> | undefined;

    const queueChips = parseChipCloud(subHeaderChipCloud || panelHeaderChipCloud);
    const { items, automixEndpoint } = parsePanelContents(playlistPanelItems);
    const continuation = extractContinuationToken(playlistPanel);
    const currentIndex =
      typeof playlistPanel.currentIndex === 'number' ? playlistPanel.currentIndex : undefined;

    const titleRuns =
      ((panelHeader?.title as Record<string, unknown> | undefined)?.runs as Array<Record<string, unknown>> | undefined) ||
      ((queueHeader?.title as Record<string, unknown> | undefined)?.runs as Array<Record<string, unknown>> | undefined) ||
      ((queueHeader?.subtitle as Record<string, unknown> | undefined)?.runs as Array<Record<string, unknown>> | undefined);
    const title = titleRuns?.map((r) => String(r.text || '')).join('').trim() || undefined;

    const playEndpoint = panelHeader?.playEndpoint as Record<string, unknown> | undefined;
    const watchEndpoint = playEndpoint?.watchEndpoint as Record<string, unknown> | undefined;
    const currentVideoEndpoint = (obj.currentVideoEndpoint as Record<string, unknown> | undefined)
      ?.watchEndpoint as Record<string, unknown> | undefined;

    return {
      title,
      items,
      currentIndex,
      continuation,
      automixEndpoint,
      endpoint: {
        watchEndpoint: {
          videoId: (watchEndpoint?.videoId || currentVideoEndpoint?.videoId) as string | undefined,
          playlistId: (watchEndpoint?.playlistId || currentVideoEndpoint?.playlistId) as string | undefined,
          params: (watchEndpoint?.params || currentVideoEndpoint?.params) as string | undefined,
        },
      },
      queueChips,
    };
  }
  return null;
}

/**
 * Upgrades Google/YouTube thumbnail URLs to their highest available resolution.
 */
export function upgradeThumbnailUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  let upgraded = rawUrl.trim();
  if (/^https?:\/\/(lh3\.googleusercontent\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com)\//i.test(upgraded)) {
    if (/=w\d+-h\d+/i.test(upgraded)) {
      upgraded = upgraded.replace(/=w\d+-h\d+([^?\s]*)/i, (_m, rest) => {
        const updatedRest = String(rest || '').replace(/-l\d+/i, '-l100');
        return `=w1200-h1200${updatedRest}`;
      });
    } else if (/=s\d+/i.test(upgraded)) {
      upgraded = upgraded.replace(/=s\d+/i, '=s1200');
    }
  } else if (/^https?:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/[^/]+\/(?:default|mqdefault|hqdefault|sddefault)\.(jpg|webp)/i.test(upgraded)) {
    upgraded = upgraded.replace(
      /\/(default|mqdefault|hqdefault|sddefault)\.(jpg|webp)/i,
      '/maxresdefault.$2',
    );
  }
  return upgraded;
}

export function pickBestThumbnailUrl(
  thumbs: Array<{ url?: string; width?: number; height?: number }> | undefined,
): string {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return '';
  let best = thumbs[thumbs.length - 1];
  let bestArea = (best?.width || 0) * (best?.height || 0);
  for (const t of thumbs) {
    const area = (t?.width || 0) * (t?.height || 0);
    if (t?.url && area > bestArea) {
      best = t;
      bestArea = area;
    }
  }
  const raw = String(best?.url || thumbs[0]?.url || '');
  return raw ? upgradeThumbnailUrl(raw) : '';
}

function parsePlaylistPanelVideoRenderer(renderer: Record<string, unknown>): NormalizedYtTrack | null {
  const videoId = (renderer.videoId as string) || '';
  if (!videoId) return null;

  const titleRuns = (renderer.title as Record<string, unknown> | undefined)?.runs as
    | Array<Record<string, unknown>>
    | undefined;
  const title = (titleRuns || []).map((r) => String(r.text || '')).join('').trim();
  if (!title) return null;

  const longBylineText = renderer.longBylineText as Record<string, unknown> | undefined;
  const shortBylineText = renderer.shortBylineText as Record<string, unknown> | undefined;
  const bylineRuns = (longBylineText?.runs || shortBylineText?.runs || []) as Array<
    Record<string, unknown>
  >;

  const artistParts: string[] = [];
  let artistId: string | undefined;
  let album = 'YouTube Music';
  let albumId: string | undefined;

  for (const run of bylineRuns) {
    const txt = String(run.text || '').trim();
    if (!txt || txt === '•' || txt === ',' || txt === '&') continue;
    const nav = run.navigationEndpoint as Record<string, unknown> | undefined;
    const browseId = (nav?.browseEndpoint as Record<string, unknown> | undefined)?.browseId as
      | string
      | undefined;
    if (browseId?.startsWith('MPRE')) {
      album = txt;
      albumId = browseId;
    } else if (/^\d{4}$/.test(txt)) {
      continue;
    } else if (!/^\d[\d,.]*[KMB]?\s*(views|plays)?$/i.test(txt)) {
      if (!artistId && browseId?.startsWith('UC')) {
        artistId = browseId;
      }
      if (album === 'YouTube Music' && artistParts.length > 0 && !browseId?.startsWith('UC')) {
        album = txt;
      } else {
        artistParts.push(txt);
      }
    }
  }

  const artist = artistParts.join(', ') || 'YouTube Music';

  const lengthRuns = (renderer.lengthText as Record<string, unknown> | undefined)?.runs as
    | Array<Record<string, unknown>>
    | undefined;
  const lengthText =
    (lengthRuns ? lengthRuns.map((r) => String(r.text || '')).join('').trim() : '') ||
    String((renderer.lengthText as Record<string, unknown> | undefined)?.simpleText || '') ||
    '3:00';
  const durationSec = parseDurationTextToSec(lengthText);

  const thumbnail =
    ((renderer.thumbnail as Record<string, unknown> | undefined)?.thumbnails as Array<{
      url?: string;
      width?: number;
      height?: number;
    }>) || [];
  const rawThumb = pickBestThumbnailUrl(thumbnail);
  const thumbSource = rawThumb || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  const thumbnailUrl = `/api/proxy-image?url=${encodeURIComponent(thumbSource)}`;

  const streamParams = new URLSearchParams({
    videoId,
    title,
    artist,
  });

  return {
    id: `ytm-${videoId}`,
    title,
    artist,
    artistId,
    album,
    albumId,
    durationSec,
    thumbnailUrl,
    streamUrl: `/api/ytmusic/stream?${streamParams.toString()}`,
    ytMusicVideoId: videoId,
    genre: 'YouTube Music',
    qualityLabel: 'YTM AAC',
    source: 'ytmusic',
  };
}

export function extractYtMusicPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed === 'LM' || trimmed === 'VLLM') {
    return 'LM';
  }
  if (/^(PL|OLAK5uy_|RDCLAK5uy_|UU|LL|FL)[a-zA-Z0-9_-]{2,}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^VL(PL|OLAK5uy_|RDCLAK5uy_)[a-zA-Z0-9_-]{2,}$/.test(trimmed)) {
    return trimmed.slice(2);
  }
  try {
    const url = new URL(trimmed);
    const listParam = url.searchParams.get('list');
    if (listParam && listParam.length >= 2) return listParam;
  } catch {
    // ignore invalid URL
  }
  return null;
}

export function parseDurationTextToSec(text: string): number {
  const clean = text.trim();
  if (!/^\d+(?::\d{2}){1,2}$/.test(clean)) return 180;
  const parts = clean.split(':').map((n) => parseInt(n, 10));
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 180;
}

export function extractSapisidFromCookie(cookie: string): string | null {
  if (!cookie) return null;
  const parts = cookie.split(';');
  let fallback3p: string | null = null;
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === 'SAPISID' && val) {
      return val;
    }
    if (key === '__Secure-3PAPISID' && val && !fallback3p) {
      fallback3p = val;
    }
  }
  return fallback3p;
}

export function parseSignatureCipher(cipher: string): {
  url: string;
  s?: string;
  sp?: string;
} | null {
  if (!cipher) return null;
  const params = new URLSearchParams(cipher);
  const url = params.get('url');
  if (!url) return null;
  return {
    url,
    s: params.get('s') || undefined,
    sp: params.get('sp') || 'sig',
  };
}

interface TextRun {
  text?: string;
  navigationEndpoint?: {
    browseEndpoint?: {
      browseId?: string;
      params?: string;
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: {
          pageType?: string;
        };
      };
    };
    watchEndpoint?: {
      videoId?: string;
      playlistId?: string;
    };
  };
}

interface MusicListItemRenderer {
  playlistItemData?: { videoId?: string };
  overlay?: {
    musicItemThumbnailOverlayRenderer?: {
      content?: {
        musicPlayButtonRenderer?: {
          playNavigationEndpoint?: {
            watchEndpoint?: { videoId?: string };
          };
        };
      };
    };
  };
  thumbnail?: {
    musicThumbnailRenderer?: {
      thumbnail?: {
        thumbnails?: Array<{ url?: string; width?: number }>;
      };
    };
  };
  flexColumns?: Array<{
    musicResponsiveListItemFlexColumnRenderer?: {
      text?: {
        runs?: TextRun[];
      };
    };
  }>;
  fixedColumns?: Array<{
    musicResponsiveListItemFixedColumnRenderer?: {
      text?: {
        runs?: TextRun[];
      };
    };
  }>;
}

interface MusicTwoRowItemRenderer {
  title?: {
    runs?: TextRun[];
  };
  subtitle?: {
    runs?: TextRun[];
  };
  navigationEndpoint?: {
    browseEndpoint?: {
      browseId?: string;
      params?: string;
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: {
          pageType?: string;
        };
      };
    };
    watchEndpoint?: {
      videoId?: string;
      playlistId?: string;
    };
  };
  thumbnailRenderer?: {
    musicThumbnailRenderer?: {
      thumbnail?: {
        thumbnails?: Array<{ url?: string; width?: number }>;
      };
    };
  };
}

function normalizeTrackFromListItem(r: MusicListItemRenderer): NormalizedYtTrack | null {
  const rAny = r as any;
  const videoId =
    r.playlistItemData?.videoId ||
    r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId ||
    rAny.navigationEndpoint?.watchEndpoint?.videoId ||
    rAny.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
    rAny.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
    rAny.videoId ||
    rAny.doubleTapEndpoint?.watchEndpoint?.videoId ||
    rAny.menu?.menuRenderer?.items?.find((it: any) => it?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint?.videoId)?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId) return null;

  const flex0 = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const flex1 = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const flex2 = r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const fixed0 = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs || [];

  const title = (
    flex0.map((run) => run.text || '').join('').trim() ||
    (rAny.title?.runs || []).map((x: any) => x.text || '').join('').trim() ||
    rAny.title?.simpleText ||
    ''
  ).trim();
  if (!title) return null;

  const metaRuns = [...flex1, ...flex2].filter((run) => {
    const txt = (run.text || '').trim();
    return txt && txt !== '•' && txt !== 'Song' && txt !== 'Video';
  });

  let artist = 'YouTube Music';
  let artistId: string | undefined;
  let album = 'YouTube Music';
  let albumId: string | undefined;
  let durationSec = 180;

  if (metaRuns.length === 0 && (rAny.longBylineText?.runs || rAny.shortBylineText?.runs)) {
    const bylineRuns = rAny.longBylineText?.runs || rAny.shortBylineText?.runs || [];
    artist = bylineRuns.map((x: any) => x.text || '').join('').trim() || artist;
  }
  if (rAny.lengthText?.runs || rAny.lengthText?.simpleText) {
    const durStr =
      (rAny.lengthText.runs || []).map((x: any) => x.text || '').join('').trim() ||
      rAny.lengthText.simpleText ||
      '';
    if (durStr) durationSec = parseDurationTextToSec(durStr);
  }

  for (const run of metaRuns) {
    const txt = (run.text || '').trim();
    const browseId = run.navigationEndpoint?.browseEndpoint?.browseId;
    if (/^\d+(?::\d{2}){1,2}$/.test(txt)) {
      durationSec = parseDurationTextToSec(txt);
    } else if (browseId?.startsWith('UC') || artist === 'YouTube Music') {
      if (artist === 'YouTube Music' && !/^\d[\d,.]*[KMB]?\s*(views|plays)?$/i.test(txt)) {
        artist = txt;
        artistId = browseId;
      } else if (browseId?.startsWith('MPRE') || album === 'YouTube Music') {
        album = txt;
        albumId = browseId;
      }
    } else if (browseId?.startsWith('MPRE')) {
      album = txt;
      albumId = browseId;
    }
  }

  const fixedDur = fixed0.map((x) => x.text || '').join('').trim();
  if (/^\d+(?::\d{2}){1,2}$/.test(fixedDur)) {
    durationSec = parseDurationTextToSec(fixedDur);
  }

  const thumbs =
    r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    rAny.thumbnail?.thumbnails ||
    [];
  const bestThumb = pickBestThumbnailUrl(thumbs);
  const proxiedArt = bestThumb ? `/api/proxy-image?url=${encodeURIComponent(bestThumb)}` : '';

  if (rAny.lengthSeconds && !isNaN(parseInt(rAny.lengthSeconds, 10))) {
    durationSec = parseInt(rAny.lengthSeconds, 10);
  }

  const streamParams = new URLSearchParams({
    videoId,
    title,
    artist,
  });

  return {
    id: `ytm-${videoId}`,
    title,
    artist,
    artistId,
    album,
    albumId,
    durationSec,
    thumbnailUrl: proxiedArt,
    streamUrl: `/api/ytmusic/stream?${streamParams.toString()}`,
    ytMusicVideoId: videoId,
    genre: 'YouTube Music',
    qualityLabel: 'YTM AAC',
    source: 'ytmusic',
  };
}

function collectListItems(node: unknown, out: MusicListItemRenderer[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 16) return;
  if (Array.isArray(node)) {
    for (const item of node) collectListItems(item, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.musicResponsiveListItemRenderer && typeof obj.musicResponsiveListItemRenderer === 'object') {
    out.push(obj.musicResponsiveListItemRenderer as MusicListItemRenderer);
  }
  if (obj.playlistPanelVideoRenderer && typeof obj.playlistPanelVideoRenderer === 'object') {
    out.push(obj.playlistPanelVideoRenderer as MusicListItemRenderer);
  }
  if (obj.playlistVideoRenderer && typeof obj.playlistVideoRenderer === 'object') {
    out.push(obj.playlistVideoRenderer as MusicListItemRenderer);
  }
  if (obj.gridVideoRenderer && typeof obj.gridVideoRenderer === 'object') {
    out.push(obj.gridVideoRenderer as MusicListItemRenderer);
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      collectListItems(value, out, depth + 1);
    }
  }
}

export function parseInnertubeSearchItems(json: unknown): NormalizedYtTrack[] {
  const renderers: MusicListItemRenderer[] = [];
  collectListItems(json, renderers);

  const tracks: NormalizedYtTrack[] = [];
  const seen = new Set<string>();

  for (const r of renderers) {
    const normalized = normalizeTrackFromListItem(r);
    if (!normalized || seen.has(normalized.ytMusicVideoId)) continue;
    seen.add(normalized.ytMusicVideoId);
    tracks.push(normalized);
  }

  return tracks;
}

function normalizeTwoRowCard(
  item: MusicTwoRowItemRenderer,
  fallbackKind: ParsedYtBrowseCard['kind'] = 'playlist',
): ParsedYtBrowseCard | null {
  const title = (item.title?.runs || []).map((r) => r.text || '').join('').trim();
  if (!title) return null;

  const subtitle = (item.subtitle?.runs || [])
    .map((r) => r.text || '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  const thumbs = item.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  const rawThumb = pickBestThumbnailUrl(thumbs);
  const thumbnailUrl = rawThumb ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : '';

  const browseId = item.navigationEndpoint?.browseEndpoint?.browseId;
  const params = item.navigationEndpoint?.browseEndpoint?.params;
  const pageType =
    item.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType;
  const watchVid = item.navigationEndpoint?.watchEndpoint?.videoId;
  const watchPlaylist = item.navigationEndpoint?.watchEndpoint?.playlistId;

  let kind: ParsedYtBrowseCard['kind'] = fallbackKind;
  if (watchVid) {
    kind = 'song';
  } else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId?.startsWith('MPRE')) {
    kind = 'album';
  } else if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' || browseId?.startsWith('UC')) {
    kind = 'artist';
  } else if (
    pageType === 'MUSIC_PAGE_TYPE_PLAYLIST' ||
    browseId?.startsWith('VL') ||
    browseId?.startsWith('PL') ||
    browseId?.startsWith('RD') ||
    watchPlaylist
  ) {
    kind = 'playlist';
  }

  const effectiveBrowseId = browseId?.startsWith('PL')
    ? `VL${browseId}`
    : browseId ||
      (watchPlaylist ? (watchPlaylist.startsWith('VL') ? watchPlaylist : `VL${watchPlaylist}`) : undefined);
  let track: NormalizedYtTrack | undefined;

  if (watchVid) {
    const artistGuess =
      subtitle
        .split('•')
        .map((s) => s.trim())
        .find((s) => s && !/^(song|video)$/i.test(s)) || 'YouTube Music';
    const streamParams = new URLSearchParams({
      videoId: watchVid,
      title,
      artist: artistGuess,
    });
    track = {
      id: `ytm-${watchVid}`,
      title,
      artist: artistGuess,
      album: 'YouTube Music',
      durationSec: 180,
      thumbnailUrl,
      streamUrl: `/api/ytmusic/stream?${streamParams.toString()}`,
      ytMusicVideoId: watchVid,
      genre: 'YouTube Music',
      qualityLabel: 'YTM AAC',
      source: 'ytmusic',
    };
  }

  return {
    id: watchVid ? `ytm-${watchVid}` : effectiveBrowseId || `card-${title}`,
    kind,
    title,
    subtitle: subtitle || (kind === 'artist' ? 'Artist' : 'YouTube Music'),
    thumbnailUrl,
    browseId: effectiveBrowseId,
    videoId: watchVid,
    params,
    track,
  };
}

function collectTwoRowRenderers(node: unknown, out: MusicTwoRowItemRenderer[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 14) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTwoRowRenderers(item, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.musicTwoRowItemRenderer && typeof obj.musicTwoRowItemRenderer === 'object') {
    out.push(obj.musicTwoRowItemRenderer as MusicTwoRowItemRenderer);
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      collectTwoRowRenderers(value, out, depth + 1);
    }
  }
}

export function normalizeBrowseCardFromListItem(
  r: MusicListItemRenderer,
  fallbackKind: ParsedYtBrowseCard['kind'] = 'playlist',
): ParsedYtBrowseCard | null {
  const rAny = r as Record<string, unknown>;
  const flex0 = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const flex1 = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
  const flex2 = r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

  const title = (
    flex0.map((x) => x.text || '').join('').trim() ||
    ((rAny.title as { runs?: TextRun[] })?.runs || []).map((x) => x.text || '').join('').trim() ||
    (rAny.title as { simpleText?: string })?.simpleText ||
    ''
  ).trim();
  if (!title) return null;

  const subtitle = [...flex1, ...flex2]
    .map((x) => x.text || '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  const thumbs =
    r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    (rAny.thumbnail as { thumbnails?: Array<{ url: string; width?: number; height?: number }> })?.thumbnails ||
    [];
  const rawThumb = pickBestThumbnailUrl(thumbs);
  const thumbnailUrl = rawThumb ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : '';

  const rootNav = ((r as Record<string, unknown>).navigationEndpoint || rAny.navigationEndpoint) as
    | TextRun['navigationEndpoint']
    | undefined;
  const flex0Nav = flex0[0]?.navigationEndpoint;
  const nav = rootNav || flex0Nav;

  const menuItems = (
    rAny.menu as {
      menuRenderer?: {
        items?: Array<{
          menuNavigationItemRenderer?: { navigationEndpoint?: { browseEndpoint?: { browseId?: string } } };
        }>;
      };
    }
  )?.menuRenderer?.items;
  const menuBrowseId = menuItems?.find(
    (it) => it?.menuNavigationItemRenderer?.navigationEndpoint?.browseEndpoint?.browseId,
  )?.menuNavigationItemRenderer?.navigationEndpoint?.browseEndpoint?.browseId;

  const rawBrowseId = nav?.browseEndpoint?.browseId || menuBrowseId;
  const browseId = rawBrowseId?.startsWith('PL') ? `VL${rawBrowseId}` : rawBrowseId;
  const pageType =
    nav?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const watchVid =
    nav?.watchEndpoint?.videoId ||
    (
      r.overlay as {
        musicItemThumbnailOverlayRenderer?: {
          content?: {
            musicPlayButtonRenderer?: { playNavigationEndpoint?: { watchEndpoint?: { videoId?: string } } };
          };
        };
      }
    )?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
      ?.watchEndpoint?.videoId;

  let kind: ParsedYtBrowseCard['kind'] = fallbackKind;
  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' || browseId?.startsWith('UC')) {
    kind = 'artist';
  } else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId?.startsWith('MPRE')) {
    kind = 'album';
  } else if (
    pageType === 'MUSIC_PAGE_TYPE_PLAYLIST' ||
    browseId?.startsWith('VL') ||
    browseId?.startsWith('PL') ||
    browseId?.startsWith('RD')
  ) {
    kind = 'playlist';
  } else if (watchVid) {
    kind = 'song';
  }

  const track = watchVid ? normalizeTrackFromListItem(r) || undefined : undefined;

  return {
    id: browseId || (watchVid ? `ytm-${watchVid}` : `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
    kind,
    title,
    subtitle,
    thumbnailUrl,
    browseId,
    videoId: watchVid,
    params: nav?.browseEndpoint?.params,
    track,
  };
}

export function parseInnertubeBrowseCards(
  json: unknown,
  fallbackKind: ParsedYtBrowseCard['kind'] = 'playlist',
): ParsedYtBrowseCard[] {
  const cards: ParsedYtBrowseCard[] = [];
  const seen = new Set<string>();

  const walkTopResult = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walkTopResult(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.musicCardShelfRenderer && typeof obj.musicCardShelfRenderer === 'object') {
      const cardShelf = obj.musicCardShelfRenderer as Record<string, unknown>;
      const titleRuns = (cardShelf.title as { runs?: TextRun[] })?.runs || [];
      const title = titleRuns.map((r) => r.text || '').join('').trim();
      const subtitleRuns = (cardShelf.subtitle as { runs?: TextRun[] })?.runs || [];
      const subtitle = subtitleRuns.map((r) => r.text || '').join('').replace(/\s+/g, ' ').trim();
      const thumbs =
        (
          cardShelf.thumbnail as {
            musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Array<{ url: string; width?: number; height?: number }> } };
          }
        )?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const rawThumb = pickBestThumbnailUrl(thumbs);
      const thumbnailUrl = rawThumb ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : '';
      const nav = titleRuns[0]?.navigationEndpoint as
        | { browseEndpoint?: { browseId?: string }; watchEndpoint?: { videoId?: string } }
        | undefined;
      const rawBrowseId = nav?.browseEndpoint?.browseId;
      const browseId = rawBrowseId?.startsWith('PL') ? `VL${rawBrowseId}` : rawBrowseId;
      const watchVid = nav?.watchEndpoint?.videoId;
      let kind: ParsedYtBrowseCard['kind'] = 'artist';
      if (browseId?.startsWith('MPRE')) kind = 'album';
      else if (browseId?.startsWith('VL') || browseId?.startsWith('PL')) kind = 'playlist';
      else if (watchVid) kind = 'song';
      if (title && !seen.has(browseId || title)) {
        seen.add(browseId || title);
        cards.push({
          id: browseId || `top-${title}`,
          kind,
          title,
          subtitle: subtitle ? `Top Result • ${subtitle}` : 'Top Result',
          thumbnailUrl,
          browseId,
          videoId: watchVid,
        });
      }
    }
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') walkTopResult(val, depth + 1);
    }
  };
  walkTopResult(json, 0);

  const twoRow: MusicTwoRowItemRenderer[] = [];
  collectTwoRowRenderers(json, twoRow);
  for (const r of twoRow) {
    const card = normalizeTwoRowCard(r, fallbackKind);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }

  const listItems: MusicListItemRenderer[] = [];
  collectListItems(json, listItems);
  for (const item of listItems) {
    const card = normalizeBrowseCardFromListItem(item, fallbackKind);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }

  return cards;
}

export function parseInnertubeHomeFeed(json: unknown): {
  sections: ParsedYtHomeSection[];
  chips: ParsedYtChip[];
  tracks: NormalizedYtTrack[];
} {
  const sections: ParsedYtHomeSection[] = [];
  const chips: ParsedYtChip[] = [];
  const tracks: NormalizedYtTrack[] = [];
  const seenTrackIds = new Set<string>();

  const walk = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (Array.isArray(node)) {
      for (const el of node) walk(el, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;

    if (obj.chipCloudChipRenderer && typeof obj.chipCloudChipRenderer === 'object') {
      const chip = obj.chipCloudChipRenderer as {
        text?: { runs?: TextRun[] };
        navigationEndpoint?: { browseEndpoint?: { browseId?: string; params?: string } };
      };
      const title = (chip.text?.runs || []).map((r) => r.text || '').join('').trim();
      const browseId = chip.navigationEndpoint?.browseEndpoint?.browseId || 'FEmusic_home';
      const params = chip.navigationEndpoint?.browseEndpoint?.params;
      if (title && !chips.some((c) => c.title === title)) {
        chips.push({ title, browseId, params });
      }
    }

    const shelf =
      (obj.musicCarouselShelfRenderer as {
        header?: {
          musicCarouselShelfBasicHeaderRenderer?: { title?: { runs?: TextRun[] } };
        };
        contents?: Array<Record<string, unknown>>;
      }) ||
      (obj.musicImmersiveCarouselShelfRenderer as {
        header?: {
          musicCarouselShelfBasicHeaderRenderer?: { title?: { runs?: TextRun[] } };
        };
        contents?: Array<Record<string, unknown>>;
      }) ||
      (obj.musicShelfRenderer as {
        title?: { runs?: TextRun[] };
        contents?: Array<Record<string, unknown>>;
      }) ||
      (obj.gridRenderer as {
        header?: { gridHeaderRenderer?: { title?: { runs?: TextRun[] } } };
        items?: Array<Record<string, unknown>>;
      });

    const shelfEntries =
      (shelf as { contents?: Array<Record<string, unknown>> })?.contents ||
      (shelf as { items?: Array<Record<string, unknown>> })?.items;

    if (shelf && Array.isArray(shelfEntries)) {
      const headerTitle =
        (
          (shelf as { header?: { musicCarouselShelfBasicHeaderRenderer?: { title?: { runs?: TextRun[] } } } })
            .header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs ||
          (shelf as { header?: { gridHeaderRenderer?: { title?: { runs?: TextRun[] } } } })
            .header?.gridHeaderRenderer?.title?.runs ||
          (shelf as { title?: { runs?: TextRun[] } }).title?.runs ||
          []
        )
          .map((r) => r.text || '')
          .join('')
          .trim() || 'Featured Picks';

      const items: ParsedYtBrowseCard[] = [];
      for (const entry of shelfEntries) {
        if (entry.musicTwoRowItemRenderer) {
          const card = normalizeTwoRowCard(
            entry.musicTwoRowItemRenderer as MusicTwoRowItemRenderer,
            'playlist',
          );
          if (card) {
            items.push(card);
            if (card.track && !seenTrackIds.has(card.track.ytMusicVideoId)) {
              seenTrackIds.add(card.track.ytMusicVideoId);
              tracks.push(card.track);
            }
          }
        } else if (entry.musicResponsiveListItemRenderer) {
          const t = normalizeTrackFromListItem(
            entry.musicResponsiveListItemRenderer as MusicListItemRenderer,
          );
          if (t) {
            if (!seenTrackIds.has(t.ytMusicVideoId)) {
              seenTrackIds.add(t.ytMusicVideoId);
              tracks.push(t);
            }
            items.push({
              id: t.id,
              kind: 'song',
              title: t.title,
              subtitle: t.artist,
              thumbnailUrl: t.thumbnailUrl,
              videoId: t.ytMusicVideoId,
              track: t,
            });
          } else {
            const card = normalizeBrowseCardFromListItem(
              entry.musicResponsiveListItemRenderer as MusicListItemRenderer,
              'playlist',
            );
            if (card) items.push(card);
          }
        }
      }

      if (items.length > 0) {
        sections.push({
          id: `sec-${sections.length}-${headerTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          title: headerTitle,
          items,
        });
      }
      return;
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') walk(val, depth + 1);
    }
  };

  walk(json, 0);
  return { sections, chips, tracks };
}

export function parseInnertubeSearchSuggestions(json: unknown): string[] {
  return parseInnertubeRichSearchSuggestions(json).queries;
}

export function parseInnertubeRichSearchSuggestions(json: unknown): {
  queries: string[];
  items: ParsedYtBrowseCard[];
} {
  const queries: string[] = [];
  const items: ParsedYtBrowseCard[] = [];
  const seenItems = new Set<string>();

  const walk = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;

    const suggestionObj =
      (obj.searchSuggestionRenderer as { suggestion?: { runs?: Array<{ text?: string }> } } | undefined) ||
      (obj.historySuggestionRenderer as { suggestion?: { runs?: Array<{ text?: string }> } } | undefined);

    if (suggestionObj) {
      const text = (suggestionObj.suggestion?.runs || [])
        .map((r) => r.text || '')
        .join('')
        .trim();
      if (text && !queries.includes(text)) {
        queries.push(text);
      }
    }

    if (
      obj.musicResponsiveListItemRenderer &&
      typeof obj.musicResponsiveListItemRenderer === 'object'
    ) {
      const card = normalizeBrowseCardFromListItem(
        obj.musicResponsiveListItemRenderer as MusicListItemRenderer,
        'song',
      );
      if (card && !seenItems.has(card.id)) {
        seenItems.add(card.id);
        items.push(card);
      }
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') walk(val, depth + 1);
    }
  };

  walk(json, 0);
  return {
    queries: queries.slice(0, 10),
    items: items.slice(0, 5),
  };
}