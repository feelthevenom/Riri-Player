import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  extractSapisidFromCookie,
  extractYtMusicPlaylistId,
  parseInnertubeBrowseCards,
  parseInnertubeHomeFeed,
  parseInnertubeNext,
  parseInnertubeSearchItems,
  parseInnertubeSearchSuggestions,
  parseSignatureCipher,
} from './src/utils/ytMusicParser.ts';
import {
  AudioQuality,
  AdaptiveAudioFormat,
  formatQualityBadge,
  isExactFullLengthMatch,
  normalizeAudioQuality,
  pickBitrateByQuality,
  selectAudioFormatCandidates,
} from './src/utils/streamQuality.ts';

// Gracefully catch background fetch timeouts and unhandled network errors
process.on('uncaughtException', (err) => {
  console.warn('[Riri Player Server Warning]:', (err as any)?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[Riri Player Server Unhandled Rejection]:', (reason as any)?.message || reason);
});

const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : process.cwd();
const PORT = 3000;
const DATA_SERVER_URL = 'https://riri-player-data.example.cloud';
const TOGETHER_SERVER_URL = '';
const IS_TOGETHER_ENABLED = TOGETHER_SERVER_URL.trim().length > 0;

interface CachedEntry<T> {
  expiresAt: number;
  data: T;
}

interface ResolvedStreamResult {
  url: string;
  qualityLabel: string;
  bitrateBps?: number;
  source: 'ytmusic' | 'mirror';
}

const searchCache = new Map<string, CachedEntry<unknown>>();
const ytmSearchCache = new Map<string, CachedEntry<unknown>>();
const ytmHomeCache = new Map<string, CachedEntry<unknown>>();
const chartsCache = new Map<string, CachedEntry<unknown>>();
const lyricsCache = new Map<string, CachedEntry<unknown>>();
const sponsorCache = new Map<string, CachedEntry<unknown>>();
const resolvedStreamCache = new Map<string, CachedEntry<ResolvedStreamResult>>();
let autoVisitorDataCache: CachedEntry<string> | null = null;
let playerScriptCache: CachedEntry<{
  sigFn?: (s: string) => string;
  nFn?: (n: string) => string;
  sts?: number;
}> | null = null;
let remoteDataCache: CachedEntry<unknown> | null = null;

function isPublicMediaUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === '::1' ||
      host.endsWith('.local')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface NormalizedTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  durationSec: number;
  thumbnailUrl: string;
  streamUrl: string;
  ytMusicVideoId?: string;
  genre: string;
  year?: number;
  explicit?: boolean;
  qualityLabel: string;
  source: 'ytmusic' | 'online';
}

interface ITunesResult {
  trackId?: number;
  collectionId?: number;
  artistId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
  releaseDate?: string;
  trackExplicitness?: string;
}

interface AudiusTrack {
  id?: string;
  title?: string;
  duration?: number;
  genre?: string;
  release_date?: string;
  artwork?: {
    '150x150'?: string;
    '480x480'?: string;
    '1000x1000'?: string;
  };
  user?: {
    id?: string;
    name?: string;
  };
  is_streamable?: boolean;
}

const AUDIUS_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.syncpundit.io',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
];

interface YtReqConfig {
  gl: string;
  hl: string;
  cookie?: string;
  visitorData?: string;
  poToken?: string;
  authUser?: string;
  dataSyncId?: string;
}

function getYtReqConfig(req: express.Request): YtReqConfig {
  const glRaw = String(req.query.gl || req.headers['x-ytm-gl'] || req.body?.gl || 'US')
    .trim()
    .toUpperCase();
  const hlRaw = String(req.query.hl || req.headers['x-ytm-hl'] || req.body?.hl || 'en').trim();
  return {
    gl: /^[A-Z]{2}$/.test(glRaw) ? glRaw : 'US',
    hl: /^[a-zA-Z-]{2,10}$/.test(hlRaw) ? hlRaw : 'en',
    cookie: String(req.headers['x-ytm-cookie'] || req.body?.cookie || '').trim() || undefined,
    visitorData:
      String(req.headers['x-ytm-visitor'] || req.body?.visitorData || '').trim() || undefined,
    poToken: String(req.headers['x-ytm-potoken'] || req.body?.poToken || '').trim() || undefined,
    authUser:
      String(req.headers['x-ytm-authuser'] || req.body?.authUserIndex || '').trim() || undefined,
    dataSyncId:
      String(req.headers['x-ytm-datasync'] || req.body?.dataSyncId || '').trim() || undefined,
  };
}

const YTM_FILTER_PARAMS: Record<string, string> = {
  songs: 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D',
  videos: 'EgWKAQIQAWoKEAMQBBAJEAoQBQ%3D%3D',
  albums: 'EgWKAQIYAWoKEAMQBBAJEAoQBQ%3D%3D',
  playlists: 'EgWKAQIoAWoKEAMQBBAJEAoQBQ%3D%3D',
  artists: 'EgWKAQIgAWoKEAMQBBAJEAoQBQ%3D%3D',
};

function buildYtClientContext(cfg: YtReqConfig) {
  const delegatedId = cfg.dataSyncId?.includes('||') ? cfg.dataSyncId.split('||')[0]?.trim() : null;
  return {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20250101.01.00',
      hl: cfg.hl,
      gl: cfg.gl,
      ...(cfg.visitorData ? { visitorData: cfg.visitorData } : {}),
    },
    ...(delegatedId ? { user: { onBehalfOfUser: delegatedId } } : {}),
  };
}

function buildYtMusicHeaders(cfg: Partial<YtReqConfig>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/',
    'X-YouTube-Client-Name': '67',
    'X-YouTube-Client-Version': '1.20250101.01.00',
    'Accept-Language': cfg.hl ? `${cfg.hl},en;q=0.9` : 'en-US,en;q=0.9',
  };

  if (cfg.visitorData?.trim()) {
    headers['X-Goog-Visitor-Id'] = cfg.visitorData.trim();
  }

  if (cfg.cookie?.trim()) {
    headers['Cookie'] = cfg.cookie.trim();
    const sapisid = extractSapisidFromCookie(cfg.cookie);
    if (sapisid) {
      const ts = Math.floor(Date.now() / 1000);
      const hash = crypto
        .createHash('sha1')
        .update(`${ts} ${sapisid} https://music.youtube.com`)
        .digest('hex');
      headers['Authorization'] = `SAPISIDHASH ${ts}_${hash}`;
      headers['X-Origin'] = 'https://music.youtube.com';
    }
    headers['X-Goog-AuthUser'] = cfg.authUser?.trim() || '0';
    if (cfg.dataSyncId?.includes('||')) {
      const pageId = cfg.dataSyncId.split('||')[0];
      if (pageId) headers['X-Goog-PageId'] = pageId;
    }
  }

  return headers;
}

// Fetch anonymous visitorData just like ArchiveTune's ensureVisitorDataReady()
async function getAnonymousVisitorData(): Promise<string> {
  if (autoVisitorDataCache && autoVisitorDataCache.expiresAt > Date.now()) {
    return autoVisitorDataCache.data;
  }
  try {
    const res = await fetch('https://music.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' },
        },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = (await res.json()) as { responseContext?: { visitorData?: string } };
      const vd = json.responseContext?.visitorData || '';
      if (vd) {
        autoVisitorDataCache = { expiresAt: Date.now() + 30 * 60 * 1000, data: vd };
        return vd;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

function extractNTransformFunction(code: string): ((n: string) => string) | undefined {
  try {
    const nCallMatch =
      code.match(/\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]+)(?:\[(\d+)\])?\(b\)/) ||
      code.match(/b=a\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]+)(?:\[(\d+)\])?\(b\)/);
    if (!nCallMatch) return undefined;
    let fnName = nCallMatch[1];
    if (nCallMatch[2] !== undefined) {
      const idx = Number(nCallMatch[2]);
      const arrMatch = code.match(
        new RegExp(`var ${fnName.replace(/\$/g, '\\$')}=\\[([^\\]]+)\\]`),
      );
      if (arrMatch) {
        const items = arrMatch[1].split(',').map((s) => s.trim());
        fnName = items[idx] || fnName;
      }
    }
    const escaped = fnName.replace(/\$/g, '\\$');
    const fnMatch = code.match(
      new RegExp(`${escaped}=function\\(([a-zA-Z0-9$]+)\\)\\{([\\s\\S]*?)return [a-zA-Z0-9$]+\\.join\\(""\\)\\};`),
    );
    if (!fnMatch) return undefined;
    const argName = fnMatch[1];
    const body = fnMatch[2];
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    vm.runInContext(
      `var nDecipher=function(${argName}){${body}return a.join("")};`,
      sandbox,
      { timeout: 250 },
    );
    return typeof sandbox.nDecipher === 'function'
      ? (sandbox.nDecipher as (n: string) => string)
      : undefined;
  } catch {
    return undefined;
  }
}

// Lightweight JS player cipher & n-parameter transformer (ArchiveTune QuickJS parity via isolated node:vm)
async function getPlayerDecipher() {
  if (playerScriptCache && playerScriptCache.expiresAt > Date.now()) {
    return playerScriptCache.data;
  }
  try {
    const pageRes = await fetch('https://music.youtube.com/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!pageRes.ok) return {};
    const html = await pageRes.text();
    const jsMatch = html.match(/"jsUrl":"(\/s\/player\/[^"]+?\/base\.js)"/);
    const stsMatch = html.match(/"STS":(\d+)/);
    const sts = stsMatch ? Number(stsMatch[1]) : undefined;
    if (!jsMatch) return { sts };

    const jsRes = await fetch(`https://music.youtube.com${jsMatch[1]}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!jsRes.ok) return { sts };
    const code = await jsRes.text();

    let sigFn: ((s: string) => string) | undefined;
    const sigNameMatch =
      code.match(/\b[cs]\s*&&\s*[adf]\.set\([^,]+\s*,\s*encodeURIComponent\(([a-zA-Z0-9$]+)\(/) ||
      code.match(/\b([a-zA-Z0-9$]{2,4})=function\(a\)\{a=a\.split\(""\);([a-zA-Z0-9$]+)\./);
    if (sigNameMatch) {
      const fnName = sigNameMatch[1];
      const fnEscaped = fnName.replace(/\$/g, '\\$');
      const fnBodyMatch = code.match(
        new RegExp(
          `(?:var\\s+)?${fnEscaped}=function\\(a\\)\\{a=a\\.split\\(""\\);([\\s\\S]*?)return a\\.join\\(""\\)\\}`,
        ),
      );
      if (fnBodyMatch) {
        const helperMatch = fnBodyMatch[1].match(/([a-zA-Z0-9$]+)\./);
        let helperDef = '';
        if (helperMatch) {
          const hName = helperMatch[1].replace(/\$/g, '\\$');
          const hBlock = code.match(new RegExp(`var ${hName}=\\{[\\s\\S]*?\\};`));
          if (hBlock) helperDef = hBlock[0];
        }
        const sandbox: Record<string, unknown> = {};
        vm.createContext(sandbox);
        vm.runInContext(
          `${helperDef}\nvar decipher=function(a){a=a.split("");${fnBodyMatch[1]}return a.join("")};`,
          sandbox,
          { timeout: 250 },
        );
        if (typeof sandbox.decipher === 'function') {
          sigFn = sandbox.decipher as (s: string) => string;
        }
      }
    }

    const nFn = extractNTransformFunction(code);
    const result = { sigFn, nFn, sts };
    playerScriptCache = { expiresAt: Date.now() + 2 * 60 * 60 * 1000, data: result };
    return result;
  } catch {
    return {};
  }
}

async function searchYtMusicInnertube(
  query: string,
  filter = 'songs',
  cfg: Partial<YtReqConfig> = {},
): Promise<NormalizedTrack[]> {
  try {
    const fullCfg: YtReqConfig = {
      gl: cfg.gl || 'US',
      hl: cfg.hl || 'en',
      cookie: cfg.cookie,
      visitorData: cfg.visitorData,
      authUser: cfg.authUser,
      dataSyncId: cfg.dataSyncId,
    };
    const body: Record<string, unknown> = {
      context: buildYtClientContext(fullCfg),
      query,
    };
    const param = YTM_FILTER_PARAMS[filter];
    if (param) {
      body.params = decodeURIComponent(param);
    }

    const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: buildYtMusicHeaders(fullCfg),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5500),
    });
    if (!res.ok) {
      if (fullCfg.cookie) {
        return await searchYtMusicInnertube(query, filter, { gl: fullCfg.gl, hl: fullCfg.hl });
      }
      return [];
    }
    const json = await res.json();
    const items = parseInnertubeSearchItems(json);
    if (items.length === 0 && fullCfg.cookie) {
      return await searchYtMusicInnertube(query, filter, { gl: fullCfg.gl, hl: fullCfg.hl });
    }
    return items;
  } catch {
    return [];
  }
}

function applyNParamTransform(rawUrl: string, nFn?: (n: string) => string): string {
  if (!nFn) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const nParam = parsed.searchParams.get('n');
    if (nParam) {
      const transformed = nFn(nParam);
      if (transformed && transformed !== nParam) {
        parsed.searchParams.set('n', transformed);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function resolveYouTubeAudioStream(
  videoId: string,
  cfg: Partial<YtReqConfig> = {},
  quality: AudioQuality = 'HIGH',
  expectedDurationSec = 0,
): Promise<ResolvedStreamResult | null> {
  const normalizedQuality = normalizeAudioQuality(quality);
  const cacheKey = `${videoId}::${normalizedQuality}::${cfg.gl || 'US'}::${Boolean(cfg.cookie)}`;
  const cached = resolvedStreamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.data;
  }

  const gl = cfg.gl || 'US';
  const hl = cfg.hl || 'en';
  const visitorData = cfg.visitorData || (await getAnonymousVisitorData());

  const webRemixClient = {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20250304.01.00',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  const fallbackClients = [
    {
      clientName: 'VISIONOS',
      clientVersion: '0.1',
      osName: 'visionOS',
      osVersion: '1.3.21O771',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice14,1',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    },
    {
      clientName: 'ANDROID_VR',
      clientVersion: '1.65.10',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12L',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      userAgent:
        'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    },
    {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
      userAgent:
        'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    },
    {
      clientName: 'WEB',
      clientVersion: '2.20250304.01.00',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    {
      clientName: 'MWEB',
      clientVersion: '2.20250304.01.00',
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    },
  ];

  // Just like ArchiveTune YTPlayerUtils: prefer WEB_REMIX first when signed in with cookies, otherwise race fast mobile clients concurrently
  const clients = cfg.cookie ? [webRemixClient, ...fallbackClients] : [...fallbackClients, webRemixClient];
  const decipherPromise = getPlayerDecipher();

  const tryClient = async (clientInfo: (typeof clients)[number]): Promise<ResolvedStreamResult> => {
    const isWebClient =
      clientInfo.clientName === 'WEB_REMIX' ||
      clientInfo.clientName === 'WEB' ||
      clientInfo.clientName === 'MWEB';
    const decipher = isWebClient ? await decipherPromise : {};

    const playerBody: Record<string, unknown> = {
      videoId,
      context: {
        client: {
          ...clientInfo,
          hl,
          gl,
          ...(visitorData ? { visitorData } : {}),
        },
        ...(cfg.dataSyncId ? { user: { onBehalfOfUser: cfg.dataSyncId.split('||')[0] } } : {}),
      },
      ...(decipher.sts
        ? { playbackContext: { contentPlaybackContext: { signatureTimestamp: decipher.sts } } }
        : {}),
      contentCheckOk: true,
      racyCheckOk: true,
      ...(cfg.poToken ? { serviceIntegrityDimensions: { poToken: cfg.poToken } } : {}),
    };

    const headers =
      clientInfo.clientName === 'WEB_REMIX'
        ? buildYtMusicHeaders({ ...cfg, visitorData })
        : {
            'Content-Type': 'application/json',
            'User-Agent': clientInfo.userAgent,
            ...(cfg.cookie && isWebClient ? { Cookie: cfg.cookie } : {}),
            ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
          };

    const res = await fetch('https://music.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers,
      body: JSON.stringify(playerBody),
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) throw new Error('yt_http_err');

    // Parse ONLY streamingData; explicitly discard adPlacements / playerAds
    const json = (await res.json()) as {
      playabilityStatus?: { status?: string };
      streamingData?: {
        expiresInSeconds?: string | number;
        adaptiveFormats?: AdaptiveAudioFormat[];
      };
    };
    if (json.playabilityStatus?.status && json.playabilityStatus.status !== 'OK') {
      throw new Error('yt_unplayable');
    }

    const candidates = selectAudioFormatCandidates(
      json.streamingData?.adaptiveFormats || [],
      normalizedQuality,
      expectedDurationSec,
    );

    for (const candidate of candidates) {
      let finalUrl = candidate.url || '';
      if (!finalUrl) {
        const rawCipher = candidate.signatureCipher || candidate.cipher;
        const parsed = rawCipher ? parseSignatureCipher(rawCipher) : null;
        if (parsed?.url) {
          finalUrl = parsed.url;
          if (parsed.s) {
            if (!decipher.sigFn) continue;
            try {
              const decodedSig = decipher.sigFn(parsed.s);
              const u = new URL(parsed.url);
              u.searchParams.set(parsed.sp || 'sig', decodedSig);
              finalUrl = u.toString();
            } catch {
              continue;
            }
          }
        }
      }
      if (!finalUrl) continue;
      finalUrl = applyNParamTransform(finalUrl, decipher.nFn);

      const expiresSec = Number(json.streamingData?.expiresInSeconds) || 3600;
      const resolved: ResolvedStreamResult = {
        url: finalUrl,
        qualityLabel: formatQualityBadge(candidate.mimeType, candidate.bitrate, normalizedQuality),
        bitrateBps: candidate.bitrate,
        source: 'ytmusic',
      };
      resolvedStreamCache.set(cacheKey, {
        expiresAt: Date.now() + Math.min(expiresSec, 3600) * 1000,
        data: resolved,
      });
      return resolved;
    }
    throw new Error('yt_no_formats');
  };

  if (cfg.cookie) {
    // Authenticated session: prioritize WEB_REMIX first, then fallback clients
    try {
      return await tryClient(webRemixClient);
    } catch {
      // fall through to concurrent fallback clients
    }
  }

  try {
    return await Promise.any(clients.slice(0, 4).map((c) => tryClient(c)));
  } catch {
    // Try remaining clients concurrently if first tier failed
    try {
      return await Promise.any(clients.slice(4).map((c) => tryClient(c)));
    } catch {
      // fall through to Piped/Invidious mirrors
    }
  }

  // Fallback 2 & 3: Piped & Invidious public instances queried concurrently (fast 2.2s ceiling)
  try {
    const pipedTask = Promise.any(
      PIPED_INSTANCES.map(async (instance) => {
        const res = await fetch(`${instance}/streams/${encodeURIComponent(videoId)}`, {
          signal: AbortSignal.timeout(2200),
        });
        if (!res.ok) throw new Error('piped_not_ok');
        const json = (await res.json()) as {
          audioStreams?: Array<{ url?: string; bitrate?: number; mimeType?: string }>;
        };
        const candidates = (json.audioStreams || [])
          .filter((s) => s.url)
          .map((s) => ({ bitrateKbps: Math.round((s.bitrate || 128000) / 1000), ...s }));
        const picked = pickBitrateByQuality(candidates, normalizedQuality);
        if (!picked?.url) throw new Error('piped_empty');
        return {
          url: picked.url,
          qualityLabel: formatQualityBadge(picked.mimeType, picked.bitrate, normalizedQuality),
          bitrateBps: picked.bitrate,
          source: 'ytmusic' as const,
        };
      }),
    );

    const invidiousTask = Promise.any(
      INVIDIOUS_INSTANCES.map(async (instance) => {
        const res = await fetch(`${instance}/api/v1/videos/${encodeURIComponent(videoId)}`, {
          signal: AbortSignal.timeout(2200),
        });
        if (!res.ok) throw new Error('inv_not_ok');
        const json = (await res.json()) as {
          adaptiveFormats?: Array<{ url?: string; type?: string; bitrate?: string }>;
        };
        const candidates = (json.adaptiveFormats || [])
          .filter((f) => f.url && f.type?.startsWith('audio/'))
          .map((f) => ({
            bitrateKbps: Math.round((Number(f.bitrate) || 128000) / 1000),
            url: f.url!,
            mimeType: f.type,
            bitrate: Number(f.bitrate) || 0,
          }));
        const picked = pickBitrateByQuality(candidates, normalizedQuality);
        if (!picked?.url) throw new Error('inv_empty');
        return {
          url: picked.url,
          qualityLabel: formatQualityBadge(picked.mimeType, picked.bitrate, normalizedQuality),
          bitrateBps: picked.bitrate,
          source: 'ytmusic' as const,
        };
      }),
    );

    return await Promise.any([pipedTask, invidiousTask]);
  } catch {
    // all community mirrors unreachable or bot-blocked
  }

  return null;
}

async function resolveFullLengthDirectMirror(
  title: string,
  artist: string,
  expectedDurationSec: number,
  quality: AudioQuality,
): Promise<ResolvedStreamResult | null> {
  const query = `${title} ${artist}`.trim();
  if (!query) return null;

  const mirrorCacheKey = `mirror::${quality}::${title.toLowerCase()}::${artist.toLowerCase()}`;
  const cachedMirror = resolvedStreamCache.get(mirrorCacheKey);
  if (cachedMirror && cachedMirror.expiresAt > Date.now()) {
    return cachedMirror.data;
  }

  const saavnLookup = async (): Promise<ResolvedStreamResult | null> => {
    try {
      const url = new URL('https://saavn.sumit.co/api/search/songs');
      url.searchParams.set('query', query);
      url.searchParams.set('limit', '10');
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(3500) });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: {
          results?: Array<{
            name?: string;
            duration?: number;
            artists?: { primary?: Array<{ name?: string }> };
            downloadUrl?: Array<{ quality?: string; url?: string }>;
          }>;
        };
      };
      for (const item of json.data?.results || []) {
        const candTitle = item.name || '';
        const candArtist = item.artists?.primary?.map((a) => a.name).filter(Boolean).join(', ') || '';
        const candDur = Number(item.duration) || 0;
        if (!isExactFullLengthMatch(title, artist, expectedDurationSec, candTitle, candArtist, candDur)) {
          continue;
        }
        const dlOptions = (item.downloadUrl || [])
          .filter((d) => d.url && d.quality)
          .map((d) => ({
            bitrateKbps: parseInt(String(d.quality).replace(/\D/g, ''), 10) || 160,
            url: d.url!,
          }));
        const picked = pickBitrateByQuality(dlOptions, quality);
        if (picked?.url) {
          return {
            url: picked.url,
            qualityLabel: `AAC ${picked.bitrateKbps}kbps`,
            bitrateBps: picked.bitrateKbps * 1000,
            source: 'mirror',
          };
        }
      }
    } catch {
      // ignore mirror failure
    }
    return null;
  };

  const audiusLookup = async (): Promise<ResolvedStreamResult | null> => {
    try {
      const audiusHits = await searchAudius(query, 8);
      for (const hit of audiusHits) {
        if (
          hit.streamUrl &&
          isExactFullLengthMatch(title, artist, expectedDurationSec, hit.title, hit.artist, hit.durationSec)
        ) {
          return {
            url: hit.streamUrl,
            qualityLabel: 'MP3 320kbps',
            bitrateBps: 320_000,
            source: 'mirror',
          };
        }
      }
    } catch {
      // ignore
    }
    return null;
  };

  const [saavnResult, audiusResult] = await Promise.all([saavnLookup(), audiusLookup()]);
  const winner = saavnResult || audiusResult;
  if (winner) {
    resolvedStreamCache.set(mirrorCacheKey, {
      expiresAt: Date.now() + 30 * 60 * 1000,
      data: winner,
    });
  }
  return winner;
}

function mapItunesTrack(item: ITunesResult): NormalizedTrack {
  const artwork = item.artworkUrl100
    ? item.artworkUrl100.replace(/100x100bb/g, '600x600bb')
    : '';
  return {
    id: `itunes-${item.trackId ?? Math.random().toString(36).slice(2)}`,
    title: item.trackName || 'Unknown Track',
    artist: item.artistName || 'Unknown Artist',
    artistId: item.artistId ? `artist-${item.artistId}` : undefined,
    album: item.collectionName || 'Single',
    albumId: item.collectionId ? `album-${item.collectionId}` : undefined,
    durationSec: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 30,
    thumbnailUrl: artwork,
    streamUrl: item.previewUrl || '',
    genre: item.primaryGenreName || 'Music',
    year: item.releaseDate ? Number(item.releaseDate.slice(0, 4)) : undefined,
    explicit: item.trackExplicitness === 'explicit',
    qualityLabel: 'AAC 256',
    source: 'online',
  };
}

function mapAudiusTrack(item: AudiusTrack, hostBase: string): NormalizedTrack | null {
  if (!item.id || !item.title || item.is_streamable === false) return null;
  const rawArt =
    item.artwork?.['480x480'] ||
    item.artwork?.['1000x1000'] ||
    item.artwork?.['150x150'] ||
    '';
  const art = rawArt ? `/api/proxy-image?url=${encodeURIComponent(rawArt)}` : '';
  return {
    id: `audius-${item.id}`,
    title: item.title,
    artist: item.user?.name || 'Independent Artist',
    artistId: item.user?.id ? `audius-artist-${item.user.id}` : undefined,
    album: item.genre ? `${item.genre} Single` : 'Audius Release',
    durationSec: Number(item.duration) || 180,
    thumbnailUrl: art,
    streamUrl: `${hostBase}/v1/tracks/${encodeURIComponent(item.id)}/stream?app_name=RiriPlayer`,
    genre: item.genre || 'Music',
    year: item.release_date ? Number(item.release_date.slice(0, 4)) : undefined,
    qualityLabel: 'MP3 320',
    source: 'online',
  };
}

async function searchAudius(query: string, limit: number): Promise<NormalizedTrack[]> {
  for (const host of AUDIUS_HOSTS) {
    try {
      const url = new URL(`${host}/v1/tracks/search`);
      url.searchParams.set('query', query);
      url.searchParams.set('app_name', 'RiriPlayer');
      url.searchParams.set('limit', String(limit));
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4500) });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: AudiusTrack[] };
      const mapped = (json.data || [])
        .map((t) => mapAudiusTrack(t, host))
        .filter((t): t is NormalizedTrack => Boolean(t));
      if (mapped.length > 0) return mapped;
    } catch {
      // try next Audius discovery node
    }
  }
  return [];
}

async function searchItunes(query: string, limit: number, country = 'US'): Promise<NormalizedTrack[]> {
  try {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', query);
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song');
    url.searchParams.set('country', country);
    url.searchParams.set('limit', String(limit));
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [];
    const json = (await response.json()) as { results?: ITunesResult[] };
    return (json.results || [])
      .filter((r) => r.trackName && r.previewUrl)
      .map(mapItunesTrack);
  } catch {
    return [];
  }
}

async function searchPipedFallback(query: string, limit: number): Promise<NormalizedTrack[]> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const url = new URL(`${instance}/search`);
      url.searchParams.set('q', query);
      url.searchParams.set('filter', 'music_songs');
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        items?: Array<{
          url?: string;
          title?: string;
          uploaderName?: string;
          thumbnail?: string;
          duration?: number;
        }>;
      };
      const items = (json.items || []).slice(0, limit);
      const tracks: NormalizedTrack[] = [];
      for (const item of items) {
        const vidMatch = item.url?.match(/[?&]v=([^&]+)/);
        const videoId = vidMatch?.[1];
        if (!videoId || !item.title) continue;
        const streamParams = new URLSearchParams({
          videoId,
          title: item.title,
          artist: item.uploaderName || 'YouTube Music',
        });
        tracks.push({
          id: `ytm-${videoId}`,
          title: item.title,
          artist: item.uploaderName || 'YouTube Music',
          album: 'YouTube Music',
          durationSec: item.duration || 180,
          thumbnailUrl: item.thumbnail
            ? `/api/proxy-image?url=${encodeURIComponent(item.thumbnail)}`
            : '',
          streamUrl: `/api/ytmusic/stream?${streamParams.toString()}`,
          ytMusicVideoId: videoId,
          genre: 'YouTube Music',
          qualityLabel: 'YTM AAC',
          source: 'ytmusic',
        });
      }
      if (tracks.length > 0) return tracks;
    } catch {
      // rotate next Piped instance
    }
  }
  return [];
}

async function combinedMusicSearch(
  query: string,
  limit = 24,
  includeYtMusic = true,
  cfg: Partial<YtReqConfig> = {},
): Promise<NormalizedTrack[]> {
  const half = Math.ceil(limit / 2);
  // Only include full-length streaming sources (YouTube Music InnerTube & full-length Audius >= 75s)
  // Never mix 30-second iTunes AudioPreview clips into playable search results
  const [ytmTracks, audiusRaw] = await Promise.all([
    includeYtMusic ? searchYtMusicInnertube(query, 'songs', cfg) : Promise.resolve([]),
    searchAudius(query, half),
  ]);
  const audiusTracks = audiusRaw.filter((t) => (t.durationSec || 0) >= 75);

  const merged: NormalizedTrack[] = [];
  const seen = new Set<string>();
  const interleaveMax = Math.max(ytmTracks.length, audiusTracks.length);

  for (let i = 0; i < interleaveMax; i++) {
    for (const candidate of [ytmTracks[i], audiusTracks[i]]) {
      if (!candidate) continue;
      const key = `${candidate.title.toLowerCase()}::${candidate.artist.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
      if (merged.length >= limit) return merged;
    }
  }

  if (merged.length === 0) {
    return await searchPipedFallback(query, limit);
  }
  return merged;
}

async function searchKuGouLyrics(title: string, artist: string, duration: number) {
  try {
    const keyword = `${artist} ${title}`.trim();
    const searchUrl = new URL('http://lyrics.kugou.com/search');
    searchUrl.searchParams.set('ver', '1');
    searchUrl.searchParams.set('man', 'yes');
    searchUrl.searchParams.set('client', 'pc');
    searchUrl.searchParams.set('keyword', keyword);
    if (duration > 0) {
      searchUrl.searchParams.set('duration', String(Math.round(duration * 1000)));
    }
    const res = await fetch(searchUrl.toString(), { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: Array<{ id?: string; accesskey?: string }>;
    };
    const best = json.candidates?.[0];
    if (!best?.id || !best?.accesskey) return null;

    const dlUrl = new URL('http://lyrics.kugou.com/download');
    dlUrl.searchParams.set('ver', '1');
    dlUrl.searchParams.set('client', 'pc');
    dlUrl.searchParams.set('id', best.id);
    dlUrl.searchParams.set('accesskey', best.accesskey);
    dlUrl.searchParams.set('fmt', 'lrc');
    dlUrl.searchParams.set('charset', 'utf8');
    const dlRes = await fetch(dlUrl.toString(), { signal: AbortSignal.timeout(4000) });
    if (!dlRes.ok) return null;
    const dlJson = (await dlRes.json()) as { content?: string };
    if (!dlJson.content) return null;
    const decoded = Buffer.from(dlJson.content, 'base64').toString('utf8');
    return decoded || null;
  } catch {
    return null;
  }
}

export interface AppServerOptions {
  port?: number;
  host?: string;
  distDir?: string;
}

export async function startAppServer(options: AppServerOptions = {}) {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'Riri Player',
      version: '1.0',
      togetherEnabled: IS_TOGETHER_ENABLED,
      ytMusicInnerTube: true,
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      dataServerUrl: DATA_SERVER_URL,
      togetherEnabled: IS_TOGETHER_ENABLED,
    });
  });

  app.get('/api/remote-data', async (_req, res) => {
    if (remoteDataCache && remoteDataCache.expiresAt > Date.now()) {
      return res.json(remoteDataCache.data);
    }

    try {
      const response = await fetch(DATA_SERVER_URL, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        return res.json({ ok: false, fallback: true, data: null });
      }
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : null;
      const payload = { ok: true, fallback: false, data };
      remoteDataCache = { expiresAt: Date.now() + 15 * 60 * 1000, data: payload };
      return res.json(payload);
    } catch {
      return res.json({ ok: false, fallback: true, data: null });
    }
  });

  app.use('/api/together', (req, res, next) => {
    const customUrl = String(req.headers['x-together-server'] || '').trim();
    if (!IS_TOGETHER_ENABLED && !customUrl) {
      return res.status(503).json({
        enabled: false,
        error: 'Listen Together is disabled because TOGETHER_SERVER_URL is empty.',
      });
    }
    return next();
  });

  app.get('/api/together/status', (req, res) => {
    const customUrl = String(req.query.customUrl || '').trim();
    res.json({
      enabled: IS_TOGETHER_ENABLED || customUrl.length > 0,
      serverUrl: customUrl || TOGETHER_SERVER_URL,
    });
  });

  // YouTube Music InnerTube Home Feed (FEmusic_home + regional gl/hl + optional personalized SAPISIDHASH)
  app.get('/api/ytmusic/home', async (req, res) => {
    const cfg = getYtReqConfig(req);
    const params = String(req.query.params || '').trim();
    const cacheKey = `${cfg.gl}::${cfg.hl}::${params}::${Boolean(cfg.cookie)}`;
    if (!cfg.cookie) {
      const cached = ytmHomeCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }
    }

    try {
      const homeRes = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: buildYtMusicHeaders(cfg),
        body: JSON.stringify({
          context: buildYtClientContext(cfg),
          browseId: 'FEmusic_home',
          ...(params ? { params } : {}),
        }),
        signal: AbortSignal.timeout(6500),
      });

      if (homeRes.ok) {
        const homeJson = await homeRes.json();
        const parsed = parseInnertubeHomeFeed(homeJson);
        if (parsed.sections.length > 0 || parsed.tracks.length > 0) {
          const payload = {
            sections: parsed.sections,
            chips: parsed.chips,
            tracks: parsed.tracks,
            region: cfg.gl,
            language: cfg.hl,
            personalized: Boolean(cfg.cookie),
            source: 'YouTube Music',
          };
          if (!cfg.cookie) {
            ytmHomeCache.set(cacheKey, { expiresAt: Date.now() + 8 * 60 * 1000, data: payload });
          }
          return res.json(payload);
        }
      }
    } catch {
      // fall through to regional discovery fallback
    }

    const fallbackTracks = await combinedMusicSearch(
      params ? `${params} music` : 'trending hits',
      24,
      true,
      cfg,
    );
    return res.json({
      sections:
        fallbackTracks.length > 0
          ? [
              {
                id: 'sec-fallback',
                title: `Quick Picks (${cfg.gl})`,
                items: fallbackTracks.map((t) => ({
                  id: t.id,
                  kind: 'song',
                  title: t.title,
                  subtitle: t.artist,
                  thumbnailUrl: t.thumbnailUrl,
                  videoId: t.ytMusicVideoId,
                  track: t,
                })),
              },
            ]
          : [],
      chips: [],
      tracks: fallbackTracks,
      region: cfg.gl,
      language: cfg.hl,
      personalized: false,
      source: 'Regional Discovery Fallback',
    });
  });

  // Generic InnerTube Browse (open any Album MPRE..., Playlist VL..., or Artist UC...)
  app.get('/api/ytmusic/browse', async (req, res) => {
    const browseId = String(req.query.browseId || '').trim();
    const params = String(req.query.params || '').trim();
    if (!browseId) return res.status(400).json({ error: 'Missing browseId' });
    const cfg = getYtReqConfig(req);

    try {
      const resp = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: buildYtMusicHeaders(cfg),
        body: JSON.stringify({
          context: buildYtClientContext(cfg),
          browseId,
          ...(params ? { params } : {}),
        }),
        signal: AbortSignal.timeout(6500),
      });
      if (!resp.ok) {
        return res.status(502).json({ error: 'InnerTube browse failed' });
      }
      const json = (await resp.json()) as {
        header?: {
          musicDetailHeaderRenderer?: {
            title?: { runs?: Array<{ text?: string }> };
            subtitle?: { runs?: Array<{ text?: string }> };
          };
          musicResponsiveHeaderRenderer?: {
            title?: { runs?: Array<{ text?: string }> };
            subtitle?: { runs?: Array<{ text?: string }> };
          };
          musicImmersiveHeaderRenderer?: {
            title?: { runs?: Array<{ text?: string }> };
          };
        };
      };
      const title =
        json.header?.musicDetailHeaderRenderer?.title?.runs?.map((r) => r.text).join('') ||
        json.header?.musicResponsiveHeaderRenderer?.title?.runs?.map((r) => r.text).join('') ||
        json.header?.musicImmersiveHeaderRenderer?.title?.runs?.map((r) => r.text).join('') ||
        'YouTube Music Collection';
      const subtitle =
        json.header?.musicDetailHeaderRenderer?.subtitle?.runs?.map((r) => r.text).join('') ||
        json.header?.musicResponsiveHeaderRenderer?.subtitle?.runs?.map((r) => r.text).join('') ||
        '';
      const tracks = parseInnertubeSearchItems(json);
      const cards = parseInnertubeBrowseCards(json, 'playlist');
      return res.json({ title, subtitle, tracks, cards });
    } catch {
      return res.status(502).json({ error: 'Failed to browse YouTube Music item' });
    }
  });

  // Live InnerTube Search Suggestions (/youtubei/v1/music/get_search_suggestions)
  app.get('/api/ytmusic/suggestions', async (req, res) => {
    const input = String(req.query.q || '').trim();
    if (!input) return res.json({ suggestions: [] });
    const cfg = getYtReqConfig(req);
    try {
      const resp = await fetch(
        'https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false',
        {
          method: 'POST',
          headers: buildYtMusicHeaders(cfg),
          body: JSON.stringify({
            context: buildYtClientContext(cfg),
            input,
          }),
          signal: AbortSignal.timeout(3500),
        },
      );
      if (!resp.ok) return res.json({ suggestions: [] });
      const json = await resp.json();
      return res.json({ suggestions: parseInnertubeSearchSuggestions(json) });
    } catch {
      return res.json({ suggestions: [] });
    }
  });

  // YouTube Music Next / Queue Suggestions (/youtubei/v1/next)
  // Returns limitless "Up Next" queue with automix radio, filter chips, and continuation pagination
  app.get('/api/ytmusic/next', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    const playlistId = String(req.query.playlistId || '').trim();
    const params = String(req.query.params || '').trim();
    const continuation = String(req.query.continuation || '').trim();
    const trackTitle = String(req.query.title || '').trim();
    const trackArtist = String(req.query.artist || '').trim();
    const followAutomixPreview = String(req.query.followAutomixPreview || 'true').trim() === 'true';
    const cfg = getYtReqConfig(req);

    if (!videoId && !playlistId && !continuation && !trackTitle) {
      return res.status(400).json({ error: 'Missing videoId, playlistId, continuation, or title' });
    }

    const callInnertubeNext = async (payload: Record<string, unknown>) => {
      const resp = await fetch('https://music.youtube.com/youtubei/v1/next?prettyPrint=false', {
        method: 'POST',
        headers: buildYtMusicHeaders(cfg),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(7000),
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      return parseInnertubeNext(json);
    };

    try {
      const endpoint: Record<string, unknown> = {};
      if (videoId) endpoint.videoId = videoId;
      if (playlistId) endpoint.playlistId = playlistId;
      if (params) endpoint.params = params;
      if (!continuation && !playlistId && videoId) {
        endpoint.playlistId = `RDAMVM${videoId}`;
        endpoint.params = 'wAEB';
      }

      const body: Record<string, unknown> = {
        context: buildYtClientContext(cfg),
      };
      if (continuation) {
        body.continuation = continuation;
      } else {
        body.isAudioOnly = true;
        body.enablePersistentPlaylistPanel = true;
        if (Object.keys(endpoint).length > 0) {
          Object.assign(body, endpoint);
          body.watchEndpointMusicSupportedConfigs = {
            watchEndpointMusicConfig: {
              musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
            },
          };
        }
      }

      let parsed = await callInnertubeNext(body);

      // Follow automix preview endpoint automatically if initial call yielded <= 1 tracks
      if (
        !continuation &&
        followAutomixPreview &&
        parsed &&
        parsed.items.length <= 1 &&
        parsed.automixEndpoint?.playlistId
      ) {
        const autoParsed = await callInnertubeNext({
          context: buildYtClientContext(cfg),
          isAudioOnly: true,
          enablePersistentPlaylistPanel: true,
          videoId: parsed.automixEndpoint.videoId || videoId || undefined,
          playlistId: parsed.automixEndpoint.playlistId,
          params: parsed.automixEndpoint.params || 'wAEB',
        });
        if (autoParsed && autoParsed.items.length > parsed.items.length) {
          parsed = autoParsed;
        }
      }

      // If InnerTube returned empty or only 1 track for a single videoId, try bare videoId -> RDAMVM fallback
      if (!continuation && (!parsed || parsed.items.length <= 1) && videoId && !playlistId) {
        const plainParsed = await callInnertubeNext({
          context: buildYtClientContext(cfg),
          isAudioOnly: true,
          enablePersistentPlaylistPanel: true,
          videoId,
        });
        if (plainParsed?.automixEndpoint?.playlistId) {
          const autoParsed = await callInnertubeNext({
            context: buildYtClientContext(cfg),
            isAudioOnly: true,
            enablePersistentPlaylistPanel: true,
            videoId: plainParsed.automixEndpoint.videoId || videoId,
            playlistId: plainParsed.automixEndpoint.playlistId,
            params: plainParsed.automixEndpoint.params || 'wAEB',
          });
          if (autoParsed && autoParsed.items.length > (parsed?.items.length || 0)) {
            parsed = autoParsed;
          }
        } else if (plainParsed && plainParsed.items.length > (parsed?.items.length || 0)) {
          parsed = plainParsed;
        }
      }

      // Final resilience fallback: search related YT Music songs so Queue Suggestions never dead-end
      if (!continuation && (!parsed || parsed.items.length <= 1) && (trackTitle || trackArtist)) {
        const seedQuery = `${trackArtist} ${trackTitle}`.trim();
        const related = await combinedMusicSearch(seedQuery, 20, false, cfg);
        const filtered = related
          .filter((t) => t.ytMusicVideoId && t.ytMusicVideoId !== videoId)
          .slice(0, 18);
        if (filtered.length > 0) {
          return res.json({
            title: 'Up Next Radio',
            items: filtered,
            currentIndex: 0,
            continuation: parsed?.continuation,
            endpoint: parsed?.endpoint || { watchEndpoint: { videoId } },
            automixEndpoint: parsed?.automixEndpoint,
            queueChips: parsed?.queueChips || [],
          });
        }
      }

      if (!parsed) {
        return res.json({
          title: 'Up Next',
          items: [],
          queueChips: [],
          endpoint: { watchEndpoint: { videoId, playlistId, params } },
        });
      }

      return res.json({
        title: parsed.title,
        items: parsed.items,
        currentIndex: parsed.currentIndex,
        continuation: parsed.continuation,
        automixEndpoint: parsed.automixEndpoint,
        endpoint: parsed.endpoint,
        queueChips: parsed.queueChips,
      });
    } catch {
      return res.status(502).json({ error: 'Failed to fetch next queue' });
    }
  });

  // SponsorBlock non-music segment lookup
  app.get('/api/sponsorblock', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    if (!videoId) return res.json({ segments: [] });

    const cached = sponsorCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    try {
      const url = new URL('https://sponsor.ajay.app/api/skipSegments');
      url.searchParams.set('videoID', videoId);
      url.searchParams.set(
        'categories',
        JSON.stringify(['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'music_offtopic']),
      );
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) {
        const empty = { segments: [] };
        sponsorCache.set(videoId, { expiresAt: Date.now() + 10 * 60 * 1000, data: empty });
        return res.json(empty);
      }
      const raw = (await resp.json()) as Array<{
        segment?: [number, number];
        category?: string;
      }>;
      const segments = (raw || [])
        .filter((item) => Array.isArray(item.segment) && item.segment.length === 2)
        .map((item) => ({
          startSec: item.segment![0],
          endSec: item.segment![1],
          category: item.category || 'music_offtopic',
        }));
      const payload = { segments };
      sponsorCache.set(videoId, { expiresAt: Date.now() + 60 * 60 * 1000, data: payload });
      return res.json(payload);
    } catch {
      return res.json({ segments: [] });
    }
  });

  // YouTube Music InnerTube Search (works without any API key or token)
  app.get('/api/ytmusic/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const filter = String(req.query.filter || 'songs').trim();
    const cfg = getYtReqConfig(req);
    if (!q) return res.json({ tracks: [] });

    const cacheKey = `${q.toLowerCase()}::${filter}::${cfg.gl}::${cfg.hl}::${Boolean(cfg.cookie)}`;
    const cached = ytmSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    let tracks = await searchYtMusicInnertube(q, filter, cfg);
    if (tracks.length === 0) {
      tracks = await searchPipedFallback(q, 18);
    }

    const payload = { tracks, source: `YouTube Music InnerTube (${cfg.gl})` };
    if (tracks.length > 0) {
      ytmSearchCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1000, data: payload });
    }
    return res.json(payload);
  });

  // Pre-flight stream resolver (checks direct raw stream vs browser YouTube full-song bridge)
  app.get('/api/ytmusic/stream-info', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const durationSec = Number(req.query.durationSec) || 0;
    const quality = normalizeAudioQuality(String(req.query.quality || 'HIGH'));
    const cfg = getYtReqConfig(req);

    if (!videoId && !title) {
      return res.status(400).json({ ok: false, error: 'Missing videoId or title' });
    }

    const [ytResolved, mirrorResolved] = await Promise.all([
      videoId ? resolveYouTubeAudioStream(videoId, cfg, quality, durationSec) : Promise.resolve(null),
      title ? resolveFullLengthDirectMirror(title, artist, durationSec, quality) : Promise.resolve(null),
    ]);
    const resolved = ytResolved || mirrorResolved;

    if (resolved) {
      const streamParams = new URLSearchParams();
      if (videoId) streamParams.set('videoId', videoId);
      if (title) streamParams.set('title', title);
      if (artist) streamParams.set('artist', artist);
      if (durationSec > 0) streamParams.set('durationSec', String(durationSec));
      streamParams.set('quality', quality);
      streamParams.set('gl', cfg.gl);
      streamParams.set('hl', cfg.hl);
      return res.json({
        ok: true,
        mode: 'direct',
        streamUrl: `/api/ytmusic/stream?${streamParams.toString()}`,
        qualityLabel: resolved.qualityLabel,
        bitrateBps: resolved.bitrateBps || 0,
      });
    }

    // Collect alternate full-length YouTube videoIds for the SAME song in case primary restricts embeds
    const alternateVideoIds: string[] = [];
    if (title) {
      const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const altHits = await searchYtMusicInnertube(`${title} ${artist} audio`.trim(), 'songs', cfg);
      for (const hit of altHits) {
        const hitNorm = (hit.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const sameSong =
          Boolean(normTitle && hitNorm) &&
          (hitNorm.includes(normTitle) || normTitle.includes(hitNorm));
        if (
          sameSong &&
          hit.ytMusicVideoId &&
          hit.ytMusicVideoId !== videoId &&
          !alternateVideoIds.includes(hit.ytMusicVideoId)
        ) {
          alternateVideoIds.push(hit.ytMusicVideoId);
          if (alternateVideoIds.length >= 4) break;
        }
      }
    }

    if (videoId || alternateVideoIds.length > 0) {
      return res.json({
        ok: true,
        mode: 'youtube_embed',
        videoId: videoId || alternateVideoIds[0],
        alternateVideoIds,
        qualityLabel: `YTM ${quality}`,
      });
    }

    return res.status(404).json({ ok: false, error: 'No full-length audio stream available' });
  });

  // YouTube Music Stream Resolver & Range-Aware Audio Proxy (adPlacements discarded, NEVER serves 30s previews)
  app.get('/api/ytmusic/stream', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const durationSec = Number(req.query.durationSec) || 0;
    const quality = normalizeAudioQuality(String(req.query.quality || 'HIGH'));
    const cfg = getYtReqConfig(req);

    if (!videoId && !title) {
      return res.status(400).send('Missing videoId or title');
    }

    const [ytResolved, mirrorResolved] = await Promise.all([
      videoId ? resolveYouTubeAudioStream(videoId, cfg, quality, durationSec) : Promise.resolve(null),
      title ? resolveFullLengthDirectMirror(title, artist, durationSec, quality) : Promise.resolve(null),
    ]);
    const resolved = ytResolved || mirrorResolved;

    if (!resolved?.url) {
      return res.status(503).json({
        ok: false,
        reason: 'BOT_BLOCKED',
        fallback: 'youtube_embed',
        videoId,
      });
    }

    try {
      const headers: Record<string, string> = {};
      if (req.headers.range) headers['Range'] = req.headers.range;
      const upstream = await fetch(resolved.url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).send('Upstream audio stream error');
      }
      res.status(upstream.status);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-RiriPlayer-Quality', resolved.qualityLabel);
      const ct = upstream.headers.get('content-type') || 'audio/mp4';
      const cl = upstream.headers.get('content-length');
      const cr = upstream.headers.get('content-range');
      const ar = upstream.headers.get('accept-ranges') || 'bytes';
      res.setHeader('Content-Type', ct);
      if (cl) res.setHeader('Content-Length', cl);
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Accept-Ranges', ar);
      if (upstream.body) {
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.send(buf);
    } catch {
      return res.status(502).send('Failed to stream audio');
    }
  });

  // YouTube Music Playlist Importer (public playlists work without login; private with cookie)
  app.post('/api/ytmusic/import', async (req, res) => {
    const input = String(req.body?.input || '').trim();
    const cfg = getYtReqConfig(req);

    const playlistId = extractYtMusicPlaylistId(input);
    if (!playlistId) {
      return res.status(400).json({
        error: 'Invalid YouTube Music playlist URL or ID.',
      });
    }

    try {
      const browseId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`;
      const browseRes = await fetch(
        'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false',
        {
          method: 'POST',
          headers: buildYtMusicHeaders(cfg),
          body: JSON.stringify({
            context: buildYtClientContext(cfg),
            browseId,
          }),
          signal: AbortSignal.timeout(7000),
        },
      );

      if (!browseRes.ok) {
        return res.json({
          playlistTitle: 'YouTube Music Playlist',
          tracks: [],
          message: 'Could not reach YouTube Music playlist (check if private and signed in).',
        });
      }

      const json = (await browseRes.json()) as {
        header?: {
          musicDetailHeaderRenderer?: { title?: { runs?: Array<{ text?: string }> } };
          musicResponsiveHeaderRenderer?: { title?: { runs?: Array<{ text?: string }> } };
        };
      };
      const playlistTitle =
        json.header?.musicDetailHeaderRenderer?.title?.runs?.map((r) => r.text).join('') ||
        json.header?.musicResponsiveHeaderRenderer?.title?.runs?.map((r) => r.text).join('') ||
        'Imported YouTube Music Playlist';

      const tracks = parseInnertubeSearchItems(json);
      return res.json({
        playlistTitle,
        tracks,
        message:
          tracks.length > 0
            ? `Imported ${tracks.length} tracks from "${playlistTitle}".`
            : 'Playlist loaded but contained no playable items.',
      });
    } catch {
      return res.status(502).json({ error: 'Failed to fetch YouTube Music playlist.' });
    }
  });

  // Full Authenticated Library Sync: Liked Songs (VLLM / LM), User Playlists, Saved Albums, Followed Artists, Cloud Uploads
  app.post('/api/ytmusic/library', async (req, res) => {
    const cfg = getYtReqConfig(req);
    const sapisid = cfg.cookie ? extractSapisidFromCookie(cfg.cookie) : null;
    if (!cfg.cookie || !sapisid) {
      return res.status(400).json({
        ok: false,
        error: 'Cookie must include SAPISID or __Secure-3PAPISID from music.youtube.com.',
      });
    }

    const headers = buildYtMusicHeaders(cfg);
    const context = buildYtClientContext(cfg);

    const browseYt = async (browseId: string) => {
      try {
        const resp = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
          method: 'POST',
          headers,
          body: JSON.stringify({ context, browseId }),
          signal: AbortSignal.timeout(7500),
        });
        return resp.ok ? await resp.json() : null;
      } catch {
        return null;
      }
    };

    try {
      let accountName = String(req.body?.accountName || '').trim() || 'YouTube Music Account';
      let accountHandle = String(req.body?.accountHandle || '').trim();
      let avatarUrl = String(req.body?.avatarUrl || '').trim();

      const [acctRes, corpusPlsJson, likedPlsJson, albumsJson, artistsJson, uploadsJson] =
        await Promise.all([
          fetch('https://music.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false', {
            method: 'POST',
            headers,
            body: JSON.stringify({ context }),
            signal: AbortSignal.timeout(6000),
          }).catch(() => null),
          browseYt('FEmusic_library_corpus_playlists'),
          browseYt('FEmusic_liked_playlists'),
          browseYt('FEmusic_liked_albums'),
          browseYt('FEmusic_library_corpus_artists'),
          browseYt('FEmusic_library_privately_owned_tracks'),
        ]);

      if (acctRes?.ok) {
        try {
          const acctJson = await acctRes.json();
          const findAccountInfo = (node: any, depth = 0): void => {
            if (!node || typeof node !== 'object' || depth > 12) return;
            if (node.activeAccountHeaderRenderer) {
              const r = node.activeAccountHeaderRenderer;
              if (r.accountName?.runs?.[0]?.text) {
                accountName = r.accountName.runs.map((x: any) => x.text).join('') || accountName;
              } else if (r.accountName?.simpleText) {
                accountName = r.accountName.simpleText || accountName;
              }
              if (r.channelHandle?.runs?.[0]?.text) {
                accountHandle = r.channelHandle.runs.map((x: any) => x.text).join('') || accountHandle;
              } else if (r.email?.runs?.[0]?.text) {
                accountHandle = r.email.runs.map((x: any) => x.text).join('') || accountHandle;
              }
              const photoThumbs = r.accountPhoto?.thumbnails || r.avatar?.thumbnails || [];
              if (photoThumbs.length > 0) {
                avatarUrl = photoThumbs[photoThumbs.length - 1].url || photoThumbs[0].url || avatarUrl;
              }
              return;
            }
            if (node.accountItemRenderer) {
              const air = node.accountItemRenderer;
              if (air.accountName?.runs?.[0]?.text && (!accountName || accountName === 'YouTube Music Account')) {
                accountName = air.accountName.runs.map((x: any) => x.text).join('');
              }
              const airThumbs = air.accountPhoto?.thumbnails || [];
              if (airThumbs.length > 0 && !avatarUrl) {
                avatarUrl = airThumbs[airThumbs.length - 1].url || airThumbs[0].url;
              }
            }
            if (Array.isArray(node)) {
              for (const item of node) findAccountInfo(item, depth + 1);
            } else {
              for (const v of Object.values(node)) findAccountInfo(v, depth + 1);
            }
          };
          findAccountInfo(acctJson);
        } catch {
          // ignore parsing error
        }
      }

      // Try multiple browse IDs for liked songs: ArchiveTune uses 'VLLM' as primary
      let likedTracks: NormalizedTrack[] = [];
      for (const bid of ['VLLM', 'LM', 'FEmusic_liked_videos', 'VLSE']) {
        const json = await browseYt(bid);
        if (json) {
          const parsed = parseInnertubeSearchItems(json);
          if (parsed.length > 0) {
            likedTracks = parsed;
            break;
          }
        }
      }

      // Collect user created playlists AND liked playlists
      const playlistCardsRaw = [
        ...(corpusPlsJson ? parseInnertubeBrowseCards(corpusPlsJson, 'playlist') : []),
        ...(likedPlsJson ? parseInnertubeBrowseCards(likedPlsJson, 'playlist') : []),
      ];
      const seenPls = new Set<string>();
      const playlistCards = playlistCardsRaw.filter((p) => {
        const id = p.browseId || p.id;
        if (!id || id === 'VLLM' || id === 'LM' || seenPls.has(id)) return false;
        seenPls.add(id);
        return true;
      });

      const savedAlbums = albumsJson ? parseInnertubeBrowseCards(albumsJson, 'album') : [];
      const followedArtists = artistsJson ? parseInnertubeBrowseCards(artistsJson, 'artist') : [];
      const uploadedTracks = uploadsJson ? parseInnertubeSearchItems(uploadsJson) : [];

      // Hydrate tracks for up to 12 personal playlists
      const syncedPlaylists = await Promise.all(
        playlistCards.slice(0, 12).map(async (pl) => {
          const plBrowseId = pl.browseId || pl.id;
          const plJson = plBrowseId ? await browseYt(plBrowseId) : null;
          const tracks = plJson ? parseInnertubeSearchItems(plJson) : [];
          return {
            browseId: plBrowseId,
            title: pl.title,
            subtitle: pl.subtitle,
            thumbnailUrl: pl.thumbnailUrl,
            tracks,
          };
        }),
      );

      return res.json({
        ok: true,
        account: {
          name: accountName,
          handle: accountHandle,
          avatarUrl: avatarUrl ? (avatarUrl.startsWith('http') ? avatarUrl : `/api/proxy-image?url=${encodeURIComponent(avatarUrl)}`) : '',
        },
        likedTracks,
        playlists: syncedPlaylists,
        savedAlbums,
        followedArtists,
        uploadedTracks,
      });
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'Failed to contact YouTube Music with this session cookie.',
      });
    }
  });

  // Google OAuth Profile + Official YouTube Data API v3 Library Sync via Bearer Token
  app.post('/api/google/library', async (req, res) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : String(req.body?.accessToken || '').trim();

    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing Google OAuth access token.' });
    }

    const ytHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    let userInfo: { name?: string; email?: string; picture?: string } = {};
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: ytHeaders,
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        userInfo = (await resp.json()) as { name?: string; email?: string; picture?: string };
      }
    } catch {
      // Fall back to client-supplied Firebase profile metadata
    }

    const account = {
      name: userInfo.name || String(req.body?.name || 'Google User'),
      handle: userInfo.email || String(req.body?.email || ''),
      avatarUrl: userInfo.picture
        ? `/api/proxy-image?url=${encodeURIComponent(userInfo.picture)}`
        : String(req.body?.avatarUrl || ''),
    };

    const parseIsoDurationSec = (iso?: string): number => {
      if (!iso) return 180;
      const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!m) return 180;
      const total = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
      return total > 0 ? total : 180;
    };

    const toYtTrack = (
      vid: string,
      rawTitle: string,
      rawArtist: string,
      thumb?: string,
      durationSec = 180,
      liked = false,
    ): NormalizedTrack => {
      const cleanArtist = rawArtist.replace(/\s*-\s*Topic$/i, '').trim() || 'YouTube Music';
      const streamParams = new URLSearchParams({
        videoId: vid,
        title: rawTitle,
        artist: cleanArtist,
      });
      return {
        id: `ytm-${vid}`,
        title: rawTitle,
        artist: cleanArtist,
        album: 'YouTube Music',
        durationSec,
        thumbnailUrl: thumb ? `/api/proxy-image?url=${encodeURIComponent(thumb)}` : '',
        streamUrl: `/api/ytmusic/stream?${streamParams.toString()}`,
        ytMusicVideoId: vid,
        genre: 'YouTube Music',
        qualityLabel: 'YTM AAC',
        source: 'ytmusic',
        liked,
      };
    };

    let likedTracks: NormalizedTrack[] = [];
    const playlists: Array<{
      browseId: string;
      title: string;
      subtitle: string;
      thumbnailUrl: string;
      tracks: NormalizedTrack[];
    }> = [];
    const followedArtists: Array<{
      id: string;
      kind: 'artist';
      title: string;
      subtitle: string;
      thumbnailUrl: string;
      browseId: string;
    }> = [];

    try {
      const [likedRes, plsRes, subsRes] = await Promise.all([
        fetch(
          'https://www.googleapis.com/youtube/v3/videos?myRating=like&part=snippet,contentDetails&maxResults=30',
          { headers: ytHeaders, signal: AbortSignal.timeout(6000) },
        ).catch(() => null),
        fetch(
          'https://www.googleapis.com/youtube/v3/playlists?mine=true&part=snippet,contentDetails&maxResults=12',
          { headers: ytHeaders, signal: AbortSignal.timeout(6000) },
        ).catch(() => null),
        fetch(
          'https://www.googleapis.com/youtube/v3/subscriptions?mine=true&part=snippet&maxResults=15',
          { headers: ytHeaders, signal: AbortSignal.timeout(6000) },
        ).catch(() => null),
      ]);

      if (likedRes?.ok) {
        const likedJson = (await likedRes.json()) as {
          items?: Array<{
            id?: string;
            snippet?: {
              title?: string;
              channelTitle?: string;
              categoryId?: string;
              thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
            };
            contentDetails?: { duration?: string };
          }>;
        };
        likedTracks = (likedJson.items || [])
          .filter((it) => it.id && it.snippet?.title)
          .map((it) =>
            toYtTrack(
              it.id!,
              it.snippet!.title!,
              it.snippet!.channelTitle || 'YouTube Music',
              it.snippet!.thumbnails?.high?.url ||
                it.snippet!.thumbnails?.medium?.url ||
                it.snippet!.thumbnails?.default?.url,
              parseIsoDurationSec(it.contentDetails?.duration),
              true,
            ),
          );
      }

      if (plsRes?.ok) {
        const plsJson = (await plsRes.json()) as {
          items?: Array<{
            id?: string;
            snippet?: {
              title?: string;
              description?: string;
              thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
            };
            contentDetails?: { itemCount?: number };
          }>;
        };
        const rawPlaylists = (plsJson.items || []).filter((p) => p.id && p.snippet?.title).slice(0, 8);
        const fetchedPlaylists = await Promise.all(
          rawPlaylists.map(async (pl) => {
            let tracks: NormalizedTrack[] = [];
            try {
              const itemsRes = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${encodeURIComponent(pl.id!)}&part=snippet,contentDetails&maxResults=25`,
                { headers: ytHeaders, signal: AbortSignal.timeout(6000) },
              );
              if (itemsRes.ok) {
                const itemsJson = (await itemsRes.json()) as {
                  items?: Array<{
                    snippet?: {
                      title?: string;
                      videoOwnerChannelTitle?: string;
                      channelTitle?: string;
                      resourceId?: { videoId?: string };
                      thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
                    };
                    contentDetails?: { videoId?: string };
                  }>;
                };
                tracks = (itemsJson.items || [])
                  .map((item) => {
                    const vid = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '';
                    const tTitle = item.snippet?.title || '';
                    if (!vid || !tTitle || tTitle === 'Private video' || tTitle === 'Deleted video') {
                      return null;
                    }
                    return toYtTrack(
                      vid,
                      tTitle,
                      item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'YouTube Music',
                      item.snippet?.thumbnails?.high?.url ||
                        item.snippet?.thumbnails?.medium?.url ||
                        item.snippet?.thumbnails?.default?.url,
                    );
                  })
                  .filter((x): x is NormalizedTrack => Boolean(x));
              }
            } catch {
              // skip item fetch failure
            }
            const plThumb =
              pl.snippet!.thumbnails?.high?.url ||
              pl.snippet!.thumbnails?.medium?.url ||
              pl.snippet!.thumbnails?.default?.url ||
              '';
            return {
              browseId: `VL${pl.id!}`,
              title: pl.snippet!.title!,
              subtitle: pl.snippet!.description || `${tracks.length} tracks`,
              thumbnailUrl: plThumb ? `/api/proxy-image?url=${encodeURIComponent(plThumb)}` : '',
              tracks,
            };
          }),
        );
        playlists.push(...fetchedPlaylists);
      }

      if (subsRes?.ok) {
        const subsJson = (await subsRes.json()) as {
          items?: Array<{
            snippet?: {
              title?: string;
              resourceId?: { channelId?: string };
              thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
            };
          }>;
        };
        for (const sub of subsJson.items || []) {
          const cid = sub.snippet?.resourceId?.channelId;
          const title = sub.snippet?.title;
          if (!cid || !title) continue;
          const rawThumb =
            sub.snippet?.thumbnails?.high?.url ||
            sub.snippet?.thumbnails?.medium?.url ||
            sub.snippet?.thumbnails?.default?.url ||
            '';
          followedArtists.push({
            id: cid,
            kind: 'artist',
            title: title.replace(/\s*-\s*Topic$/i, '').trim(),
            subtitle: 'Subscribed Artist',
            thumbnailUrl: rawThumb ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : '',
            browseId: cid,
          });
        }
      }
    } catch {
      // YouTube Data API unavailable or scope omitted; profile sign-in still succeeds cleanly
    }

    return res.json({
      ok: true,
      account,
      likedTracks,
      playlists,
      savedAlbums: [],
      followedArtists,
      uploadedTracks: [],
    });
  });

  // Two-Way Action: Like / Remove Like directly on YouTube Music
  app.post('/api/ytmusic/like', async (req, res) => {
    const videoId = String(req.body?.videoId || '').trim();
    const liked = Boolean(req.body?.liked);
    const cfg = getYtReqConfig(req);
    if (!videoId || !cfg.cookie || !extractSapisidFromCookie(cfg.cookie)) {
      return res.status(400).json({ ok: false });
    }
    const endpoint = liked
      ? 'https://music.youtube.com/youtubei/v1/like/like?prettyPrint=false'
      : 'https://music.youtube.com/youtubei/v1/like/removelike?prettyPrint=false';
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: buildYtMusicHeaders(cfg),
        body: JSON.stringify({
          context: buildYtClientContext(cfg),
          target: { videoId },
        }),
        signal: AbortSignal.timeout(4500),
      });
      return res.json({ ok: resp.ok });
    } catch {
      return res.json({ ok: false });
    }
  });

  // Two-Way Action: Add track to a YouTube Music playlist
  app.post('/api/ytmusic/edit-playlist', async (req, res) => {
    const playlistId = String(req.body?.playlistId || '').replace(/^VL/, '').trim();
    const videoId = String(req.body?.videoId || '').trim();
    const cfg = getYtReqConfig(req);
    if (!playlistId || !videoId || !cfg.cookie || !extractSapisidFromCookie(cfg.cookie)) {
      return res.status(400).json({ ok: false });
    }
    try {
      const resp = await fetch(
        'https://music.youtube.com/youtubei/v1/browse/edit_playlist?prettyPrint=false',
        {
          method: 'POST',
          headers: buildYtMusicHeaders(cfg),
          body: JSON.stringify({
            context: buildYtClientContext(cfg),
            playlistId,
            actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }],
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      return res.json({ ok: resp.ok });
    } catch {
      return res.json({ ok: false });
    }
  });

  app.get('/api/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 50);
    const includeYtm = req.query.ytm !== '0';
    const cfg = getYtReqConfig(req);

    if (!q) {
      return res.json({ tracks: [] });
    }

    // Always perform clean unauthenticated search for global catalog queries (same before & after login)
    const searchCfg: Partial<YtReqConfig> = { gl: cfg.gl, hl: cfg.hl };
    const cacheKey = `${q.toLowerCase()}::${limit}::${includeYtm}::${searchCfg.gl}::${searchCfg.hl}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    const tracks = await combinedMusicSearch(q, limit, includeYtm, searchCfg);
    const payload = { tracks, fallback: tracks.length === 0 };
    if (tracks.length > 0) {
      searchCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1000, data: payload });
    }
    return res.json(payload);
  });

  app.get('/api/charts', async (req, res) => {
    const cfg = getYtReqConfig(req);
    const cacheKey = `trending::${cfg.gl}::${cfg.hl}`;
    const cached = chartsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    const tracks: NormalizedTrack[] = [];
    // Query official InnerTube FEmusic_charts when possible, else top songs search for region
    try {
      const chartResp = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: buildYtMusicHeaders(cfg),
        body: JSON.stringify({
          context: buildYtClientContext(cfg),
          browseId: 'FEmusic_charts',
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (chartResp.ok) {
        const parsed = parseInnertubeSearchItems(await chartResp.json());
        tracks.push(...parsed.slice(0, 14));
      }
    } catch {
      // ignore
    }

    if (tracks.length === 0) {
      const ytmCharts = await searchYtMusicInnertube(`top hits ${cfg.gl}`, 'songs', cfg);
      tracks.push(...ytmCharts.slice(0, 12));
    }

    for (const host of AUDIUS_HOSTS) {
      try {
        const resp = await fetch(`${host}/v1/tracks/trending?app_name=RiriPlayer&limit=16`, {
          signal: AbortSignal.timeout(4500),
        });
        if (!resp.ok) continue;
        const json = (await resp.json()) as { data?: AudiusTrack[] };
        const mapped = (json.data || [])
          .map((t) => mapAudiusTrack(t, host))
          .filter((t): t is NormalizedTrack => t !== null && (t.durationSec || 0) >= 75);
        if (mapped.length > 0) {
          tracks.push(...mapped);
          break;
        }
      } catch {
        // try next host
      }
    }

    const payload = { tracks };
    if (tracks.length > 0) {
      chartsCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1000, data: payload });
    }
    return res.json(payload);
  });

  app.get('/api/lyrics', async (req, res) => {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const album = String(req.query.album || '').trim();
    const duration = Number(req.query.duration) || 0;

    if (!title) {
      return res.status(400).json({ error: 'Missing title' });
    }

    const cacheKey = `${title.toLowerCase()}::${artist.toLowerCase()}::${duration}`;
    const cached = lyricsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    const headers = { 'User-Agent': 'RiriPlayer/1.0 (https://github.com/feelthevenom/Riri-Player)' };

    try {
      // 1. LRCLIB exact lookup
      if (artist && duration > 0) {
        const getUrl = new URL('https://lrclib.net/api/get');
        getUrl.searchParams.set('track_name', title);
        getUrl.searchParams.set('artist_name', artist);
        if (album) getUrl.searchParams.set('album_name', album);
        getUrl.searchParams.set('duration', String(Math.round(duration)));
        const exactResp = await fetch(getUrl.toString(), {
          headers,
          signal: AbortSignal.timeout(4500),
        });
        if (exactResp.ok) {
          const item = (await exactResp.json()) as {
            syncedLyrics?: string;
            plainLyrics?: string;
          };
          if (item.syncedLyrics || item.plainLyrics) {
            const payload = {
              syncedLyrics: item.syncedLyrics || null,
              plainLyrics: item.plainLyrics || null,
              source: 'LrcLib',
            };
            lyricsCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60 * 1000, data: payload });
            return res.json(payload);
          }
        }
      }

      // 2. LRCLIB fuzzy search
      const searchUrl = new URL('https://lrclib.net/api/search');
      searchUrl.searchParams.set('track_name', title);
      if (artist) searchUrl.searchParams.set('artist_name', artist);

      const resp = await fetch(searchUrl.toString(), {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (resp.ok) {
        const items = (await resp.json()) as Array<{
          syncedLyrics?: string;
          plainLyrics?: string;
          duration?: number;
        }>;
        const best =
          items.find(
            (i) => i.syncedLyrics && (!duration || Math.abs((i.duration || 0) - duration) <= 12),
          ) ||
          items.find((i) => i.syncedLyrics) ||
          items[0];
        if (best?.syncedLyrics || best?.plainLyrics) {
          const payload = {
            syncedLyrics: best.syncedLyrics || null,
            plainLyrics: best.plainLyrics || null,
            source: 'LrcLib',
          };
          lyricsCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60 * 1000, data: payload });
          return res.json(payload);
        }
      }

      // 3. KuGou synced lyrics fallback
      const kugouLrc = await searchKuGouLyrics(title, artist, duration);
      const payload = {
        syncedLyrics: kugouLrc,
        plainLyrics: null,
        source: kugouLrc ? 'KuGou' : null,
      };
      if (kugouLrc) {
        lyricsCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60 * 1000, data: payload });
      }
      return res.json(payload);
    } catch {
      return res.json({ syncedLyrics: null, plainLyrics: null, source: null });
    }
  });

  // Free Lyrics Line Translator (no API key required)
  app.post('/api/translate-lyrics', async (req, res) => {
    const lines = Array.isArray(req.body?.lines) ? (req.body.lines as string[]) : [];
    const targetLang = String(req.body?.targetLang || 'en').slice(0, 10);
    if (lines.length === 0) return res.json({ translations: [] });

    try {
      const joined = lines.slice(0, 60).join('\n');
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.set('client', 'gtx');
      url.searchParams.set('sl', 'auto');
      url.searchParams.set('tl', targetLang);
      url.searchParams.set('dt', 't');
      url.searchParams.set('q', joined);

      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return res.json({ translations: [] });
      const data = (await resp.json()) as Array<Array<[string]>>;
      const translatedText = (data[0] || []).map((chunk) => chunk[0] || '').join('');
      return res.json({ translations: translatedText.split('\n') });
    } catch {
      return res.json({ translations: [] });
    }
  });

  // Optional ListenBrainz / Last.fm scrobbler (runs only when user enters optional token in Settings)
  app.post('/api/scrobble', async (req, res) => {
    const { title, artist, album, listenBrainzToken } = (req.body || {}) as {
      title?: string;
      artist?: string;
      album?: string;
      listenBrainzToken?: string;
    };
    if (!title || !artist) return res.status(400).json({ ok: false });

    let scrobbled = false;
    if (listenBrainzToken?.trim()) {
      try {
        const lbRes = await fetch('https://api.listenbrainz.org/1/submit-listens', {
          method: 'POST',
          headers: {
            Authorization: `Token ${listenBrainzToken.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            listen_type: 'single',
            payload: [
              {
                listened_at: Math.floor(Date.now() / 1000),
                track_metadata: {
                  artist_name: artist,
                  track_name: title,
                  release_name: album || undefined,
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(4000),
        });
        scrobbled = lbRes.ok;
      } catch {
        scrobbled = false;
      }
    }
    return res.json({ ok: scrobbled });
  });

  const fetchSpotifyEmbedPlaylist = async (
    playlistId: string,
  ): Promise<{ title: string; queries: Array<{ title: string; artist: string }> }> => {
    const out: { title: string; queries: Array<{ title: string; artist: string }> } = {
      title: 'Imported Spotify Playlist',
      queries: [],
    };
    try {
      const embedRes = await fetch(`https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!embedRes.ok) return out;
      const html = await embedRes.text();
      const nextDataMatch = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
      );
      if (!nextDataMatch) return out;
      const parsed = JSON.parse(nextDataMatch[1]) as {
        props?: {
          pageProps?: {
            state?: {
              data?: {
                entity?: {
                  name?: string;
                  trackList?: Array<{ title?: string; subtitle?: string }>;
                };
              };
            };
          };
        };
      };
      const entity = parsed.props?.pageProps?.state?.data?.entity;
      if (entity?.name) out.title = entity.name;
      for (const item of entity?.trackList || []) {
        if (item.title) {
          out.queries.push({
            title: item.title,
            artist: item.subtitle || '',
          });
        }
      }
    } catch {
      // ignore parse failure
    }
    return out;
  };

  const fetchSpotifyPublicProfile = async (
    input: string,
  ): Promise<{
    userId: string;
    displayName: string;
    avatarUrl?: string;
    profileUrl: string;
    playlistIds: string[];
  } | null> => {
    const clean = input.trim();
    if (!clean) return null;

    const plMatch = clean.match(/playlist\/([a-zA-Z0-9]+)/) || clean.match(/spotify:playlist:([a-zA-Z0-9]+)/);
    if (plMatch) {
      return {
        userId: `playlist-${plMatch[1]}`,
        displayName: 'Spotify Linked Playlist',
        profileUrl: `https://open.spotify.com/playlist/${plMatch[1]}`,
        playlistIds: [plMatch[1]],
      };
    }

    const userMatch =
      clean.match(/open\.spotify\.com\/user\/([^/?#]+)/i) ||
      clean.match(/spotify:user:([^/?#]+)/i);
    const userId = (userMatch ? userMatch[1] : clean.replace(/^@/, '')).trim();
    if (!userId || userId.includes(' ')) return null;

    const profileUrl = `https://open.spotify.com/user/${encodeURIComponent(userId)}`;
    try {
      const res = await fetch(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
      const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
      const rawName = (titleMatch?.[1] || userId)
        .replace(/\s*\|\s*Spotify.*$/i, '')
        .replace(/\s*-\s*Spotify.*$/i, '')
        .trim();
      const playlistIds = Array.from(
        new Set([...html.matchAll(/\/playlist\/([a-zA-Z0-9]{22})/g)].map((m) => m[1])),
      ).slice(0, 12);

      return {
        userId,
        displayName: rawName || userId,
        avatarUrl: imageMatch?.[1] || '',
        profileUrl,
        playlistIds,
      };
    } catch {
      return null;
    }
  };

  app.post('/api/spotify-import', async (req, res) => {
    const raw = String(req.body?.input || '').trim();
    if (!raw) {
      return res.status(400).json({ error: 'Please provide a Spotify playlist URL or track list.' });
    }

    let queries: Array<{ title: string; artist: string }> = [];
    let playlistTitle = 'Imported Spotify Playlist';

    const match = raw.match(/playlist\/([a-zA-Z0-9]+)/) || raw.match(/spotify:playlist:([a-zA-Z0-9]+)/);
    if (match) {
      const embed = await fetchSpotifyEmbedPlaylist(match[1]);
      playlistTitle = embed.title;
      queries = embed.queries;
    } else {
      for (const line of raw.split('\n')) {
        const clean = line.trim();
        if (!clean) continue;
        const parts = clean.split(' - ');
        if (parts.length >= 2) {
          queries.push({ artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() });
        } else {
          queries.push({ artist: '', title: clean });
        }
      }
    }

    if (queries.length === 0) {
      return res.json({
        playlistTitle,
        tracks: [],
        message:
          'Could not extract tracks from that Spotify link (it may be private). You can also paste "Artist - Track" lines directly.',
      });
    }

    const resolvedTracks: NormalizedTrack[] = [];
    const batch = queries.slice(0, 18);
    const settled = await Promise.all(
      batch.map((q) => combinedMusicSearch(`${q.title} ${q.artist}`.trim(), 1, true)),
    );
    for (const hits of settled) {
      if (hits[0]) resolvedTracks.push(hits[0]);
    }

    return res.json({
      playlistTitle,
      requestedCount: queries.length,
      tracks: resolvedTracks,
    });
  });

  // Spotify OAuth 2.0 (PKCE) & Automatic Library Sync (Liked Songs + Playlists)
  const spotifyPkceStore = new Map<
    string,
    { codeVerifier: string; redirectUri: string; expiresAt: number }
  >();
  const spotifyTrackResolutionCache = new Map<string, NormalizedTrack | null>();

  const getSpotifyCredentials = () => ({
    clientId: (process.env.SPOTIFY_CLIENT_ID || '').trim(),
    clientSecret: (process.env.SPOTIFY_CLIENT_SECRET || '').trim(),
  });

  const buildSpotifyRedirectUri = (req: express.Request): string => {
    const requested = String(req.query.redirectUri || '').trim();
    if (requested) {
      return requested.replace(/\/+$/, '');
    }
    const base = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    if (base) {
      return `${base}/auth/spotify/callback`;
    }
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`).split(',')[0].trim();
    return `${proto}://${host}/auth/spotify/callback`;
  };

  app.get('/api/spotify/config-status', (req, res) => {
    const { clientId } = getSpotifyCredentials();
    return res.json({
      configured: Boolean(clientId),
      redirectUri: buildSpotifyRedirectUri(req),
    });
  });

  app.get('/api/spotify/auth-url', (req, res) => {
    const { clientId } = getSpotifyCredentials();
    if (!clientId) {
      return res.status(400).json({
        error:
          'Spotify OAuth is not configured on the server yet. Set SPOTIFY_CLIENT_ID (and optional SPOTIFY_CLIENT_SECRET) in your environment.',
        redirectUri: buildSpotifyRedirectUri(req),
      });
    }

    const redirectUri = buildSpotifyRedirectUri(req);
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const now = Date.now();
    for (const [k, v] of spotifyPkceStore.entries()) {
      if (v.expiresAt <= now) spotifyPkceStore.delete(k);
    }
    spotifyPkceStore.set(state, {
      codeVerifier,
      redirectUri,
      expiresAt: now + 10 * 60 * 1000,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      state,
      scope:
        'user-read-private user-read-email user-library-read playlist-read-private playlist-read-collaborative',
      show_dialog: 'true',
    });

    return res.json({
      url: `https://accounts.spotify.com/authorize?${params.toString()}`,
      redirectUri,
    });
  });

  app.get(['/auth/spotify/callback', '/auth/spotify/callback/'], async (req, res) => {
    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    const error = String(req.query.error || '').trim();

    const renderPopupCloseHtml = (payload: Record<string, unknown>) => {
      const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
      return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Riri Player — Spotify Sign-In</title></head>
<body style="background:#121011;color:#f5eff1;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;padding:24px;">
    <p style="font-size:14px;">Completing Spotify connection...</p>
  </div>
  <script>
    (function() {
      var data = ${safeJson};
      var deliveredToOpener = false;
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(data, '*');
          deliveredToOpener = true;
        }
      } catch (e) {}
      if (deliveredToOpener) {
        setTimeout(function() { window.close(); }, 150);
      } else {
        try {
          localStorage.setItem('riri_pending_spotify_oauth', JSON.stringify(data));
        } catch (e) {}
        window.location.replace('/?route=settings');
      }
    })();
  </script>
</body>
</html>`;
    };

    if (error || !code || !state) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(
        renderPopupCloseHtml({
          type: 'SPOTIFY_OAUTH_ERROR',
          error: error || 'Spotify authorization was cancelled or missing code/state.',
        }),
      );
    }

    const stored = spotifyPkceStore.get(state);
    spotifyPkceStore.delete(state);
    if (!stored || stored.expiresAt <= Date.now()) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(
        renderPopupCloseHtml({
          type: 'SPOTIFY_OAUTH_ERROR',
          error: 'Spotify OAuth state expired. Please try signing in again.',
        }),
      );
    }

    const { clientId, clientSecret } = getSpotifyCredentials();
    if (!clientId) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(
        renderPopupCloseHtml({
          type: 'SPOTIFY_OAUTH_ERROR',
          error: 'SPOTIFY_CLIENT_ID is missing on the server.',
        }),
      );
    }

    try {
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: stored.redirectUri,
        client_id: clientId,
        code_verifier: stored.codeVerifier,
      });
      if (clientSecret) {
        tokenBody.set('client_secret', clientSecret);
      }

      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
        signal: AbortSignal.timeout(8000),
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error_description?: string;
        error?: string;
      };

      if (!tokenRes.ok || !tokenJson.access_token) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(
          renderPopupCloseHtml({
            type: 'SPOTIFY_OAUTH_ERROR',
            error: tokenJson.error_description || tokenJson.error || 'Spotify token exchange failed.',
          }),
        );
      }

      const profileRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        signal: AbortSignal.timeout(6000),
      });
      const profile = (profileRes.ok ? await profileRes.json() : {}) as {
        id?: string;
        display_name?: string;
        email?: string;
        images?: Array<{ url?: string }>;
      };

      const session = {
        userId: profile.id || 'spotify-user',
        displayName: profile.display_name || profile.email || 'Spotify Listener',
        email: profile.email || '',
        avatarUrl: profile.images?.[0]?.url || '',
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token || '',
        expiresAt: Date.now() + (tokenJson.expires_in || 3600) * 1000,
      };

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        renderPopupCloseHtml({
          type: 'SPOTIFY_OAUTH_SUCCESS',
          session,
        }),
      );
    } catch {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(502).send(
        renderPopupCloseHtml({
          type: 'SPOTIFY_OAUTH_ERROR',
          error: 'Network error while finishing Spotify sign-in.',
        }),
      );
    }
  });

  app.post('/api/spotify/refresh', async (req, res) => {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    const { clientId, clientSecret } = getSpotifyCredentials();
    if (!refreshToken || !clientId) {
      return res.status(400).json({ error: 'Missing refreshToken or SPOTIFY_CLIENT_ID' });
    }
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      });
      if (clientSecret) body.set('client_secret', clientSecret);

      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(8000),
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error_description?: string;
      };
      if (!tokenRes.ok || !tokenJson.access_token) {
        return res.status(401).json({ error: tokenJson.error_description || 'Token refresh failed' });
      }
      return res.json({
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token || refreshToken,
        expiresAt: Date.now() + (tokenJson.expires_in || 3600) * 1000,
      });
    } catch {
      return res.status(502).json({ error: 'Failed to refresh Spotify session' });
    }
  });

  // Zero-key public Spotify Profile / Playlist connector (for Web users without Developer API keys)
  app.post('/api/spotify/connect-profile', async (req, res) => {
    const input = String(req.body?.input || '').trim();
    if (!input) {
      return res.status(400).json({ error: 'Enter your Spotify profile link, username, or playlist URL.' });
    }
    const profile = await fetchSpotifyPublicProfile(input);
    if (!profile) {
      return res.status(404).json({
        error: 'Could not find that Spotify profile or playlist. Make sure the link is public.',
      });
    }
    return res.json({
      ok: true,
      session: {
        userId: profile.userId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl || '',
        accessToken: '',
        refreshToken: '',
        expiresAt: Number.MAX_SAFE_INTEGER,
        authMode: 'public_profile',
        profileUrl: profile.profileUrl,
        playlistCount: profile.playlistIds.length,
      },
    });
  });

  app.post('/api/spotify/sync-library', async (req, res) => {
    const accessToken = String(req.body?.accessToken || '').trim();
    const authMode = String(req.body?.authMode || '').trim();
    const profileUrl = String(req.body?.profileUrl || req.body?.userId || '').trim();

    if (!accessToken && authMode !== 'public_profile') {
      return res.status(401).json({ error: 'Missing Spotify session' });
    }
    const cfg = getYtReqConfig(req);
    const spHeaders = { Authorization: `Bearer ${accessToken}` };

    interface SpotifyTrackItem {
      track?: {
        id?: string;
        name?: string;
        artists?: Array<{ name?: string }>;
        album?: { name?: string; images?: Array<{ url?: string }> };
      } | null;
    }

    const resolveSpotifyTrack = async (title: string, artist: string): Promise<NormalizedTrack | null> => {
      const cacheKey = `${title.toLowerCase()}::${artist.toLowerCase()}`;
      if (spotifyTrackResolutionCache.has(cacheKey)) {
        return spotifyTrackResolutionCache.get(cacheKey) || null;
      }
      const query = `${title} ${artist}`.trim();
      if (!query) return null;
      const hits = await combinedMusicSearch(query, 3, true, cfg);
      const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const normArtist = artist.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const primaryArtist = normArtist.split(' ')[0] || '';
      const best =
        hits.find((h) => {
          const ht = (h.title || '').toLowerCase();
          const ha = (h.artist || '').toLowerCase();
          return ht.includes(normTitle) && (!primaryArtist || ha.includes(primaryArtist));
        }) ||
        hits.find((h) => {
          const ha = (h.artist || '').toLowerCase();
          return !primaryArtist || ha.includes(primaryArtist);
        }) ||
        hits[0] ||
        null;
      spotifyTrackResolutionCache.set(cacheKey, best);
      return best;
    };

    const resolveTrackBatch = async (
      items: Array<{ title: string; artist: string }>,
    ): Promise<NormalizedTrack[]> => {
      const resolved: NormalizedTrack[] = [];
      const seen = new Set<string>();
      const chunkSize = 8;
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const settled = await Promise.all(chunk.map((item) => resolveSpotifyTrack(item.title, item.artist)));
        for (const t of settled) {
          if (t && !seen.has(t.id)) {
            seen.add(t.id);
            resolved.push(t);
          }
        }
      }
      return resolved;
    };

    try {
      // Zero-key public profile sync mode (fetches public playlists directly via open.spotify.com)
      if (!accessToken && authMode === 'public_profile') {
        const profile = await fetchSpotifyPublicProfile(profileUrl);
        if (!profile) {
          return res.status(404).json({ error: 'Could not read public Spotify profile.' });
        }
        const playlistsOut: Array<{
          spotifyId: string;
          title: string;
          description: string;
          coverUrl?: string;
          tracks: NormalizedTrack[];
        }> = [];
        const targetPlaylistIds = profile.playlistIds.slice(0, 6);
        for (let i = 0; i < targetPlaylistIds.length; i += 3) {
          const plBatch = targetPlaylistIds.slice(i, i + 3);
          const batchResults = await Promise.all(
            plBatch.map(async (pid) => {
              const embed = await fetchSpotifyEmbedPlaylist(pid);
              if (embed.queries.length === 0) return null;
              const resolvedTracks = await resolveTrackBatch(embed.queries.slice(0, 15));
              if (resolvedTracks.length === 0) return null;
              return {
                spotifyId: pid,
                title: embed.title,
                description: `Synced from Spotify (${resolvedTracks.length} tracks)`,
                coverUrl: resolvedTracks[0]?.thumbnailUrl,
                tracks: resolvedTracks,
              };
            }),
          );
          for (const item of batchResults) {
            if (item) playlistsOut.push(item);
          }
        }
        return res.json({
          syncedAt: Date.now(),
          likedTracks: [],
          playlists: playlistsOut,
        });
      }

      // 1. Authenticated Web API: Fetch Liked Songs (up to 50 recent saved tracks)
      const likedQueries: Array<{ title: string; artist: string }> = [];
      const likedRes = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', {
        headers: spHeaders,
        signal: AbortSignal.timeout(8000),
      });
      if (likedRes.status === 401) {
        return res.status(401).json({ error: 'Spotify access token expired' });
      }
      if (likedRes.ok) {
        const likedJson = (await likedRes.json()) as { items?: SpotifyTrackItem[] };
        for (const item of likedJson.items || []) {
          if (item.track?.name) {
            likedQueries.push({
              title: item.track.name,
              artist: (item.track.artists || []).map((a) => a.name).filter(Boolean).join(', '),
            });
          }
        }
      }

      // 2. Fetch User Playlists (up to 15 playlists)
      const playlistsOut: Array<{
        spotifyId: string;
        title: string;
        description: string;
        coverUrl?: string;
        tracks: NormalizedTrack[];
      }> = [];

      const plsRes = await fetch('https://api.spotify.com/v1/me/playlists?limit=15', {
        headers: spHeaders,
        signal: AbortSignal.timeout(8000),
      });
      if (plsRes.ok) {
        const plsJson = (await plsRes.json()) as {
          items?: Array<{
            id?: string;
            name?: string;
            description?: string;
            images?: Array<{ url?: string }>;
          }>;
        };
        for (const pl of plsJson.items || []) {
          if (!pl.id || !pl.name) continue;
          const plTracksRes = await fetch(
            `https://api.spotify.com/v1/playlists/${encodeURIComponent(pl.id)}/tracks?limit=35`,
            { headers: spHeaders, signal: AbortSignal.timeout(8000) },
          );
          const queries: Array<{ title: string; artist: string }> = [];
          if (plTracksRes.ok) {
            const plTracksJson = (await plTracksRes.json()) as { items?: SpotifyTrackItem[] };
            for (const entry of plTracksJson.items || []) {
              if (entry.track?.name) {
                queries.push({
                  title: entry.track.name,
                  artist: (entry.track.artists || []).map((a) => a.name).filter(Boolean).join(', '),
                });
              }
            }
          }
          const resolvedTracks = await resolveTrackBatch(queries);
          playlistsOut.push({
            spotifyId: pl.id,
            title: pl.name,
            description: pl.description || `Synced from Spotify (${resolvedTracks.length} tracks)`,
            coverUrl: pl.images?.[0]?.url || resolvedTracks[0]?.thumbnailUrl,
            tracks: resolvedTracks,
          });
        }
      }

      const likedTracks = await resolveTrackBatch(likedQueries);

      return res.json({
        syncedAt: Date.now(),
        likedTracks,
        playlists: playlistsOut,
      });
    } catch {
      return res.status(502).json({ error: 'Failed to sync Spotify library' });
    }
  });

  app.get('/api/proxy-audio', async (req, res) => {
    const target = isPublicMediaUrl(String(req.query.url || ''));
    if (!target) {
      return res.status(400).send('Invalid or disallowed audio URL');
    }

    try {
      const headers: Record<string, string> = {};
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }
      const upstream = await fetch(target.toString(), {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('application/json') && target.pathname.includes('/streams/')) {
        const streamJson = (await upstream.json()) as {
          audioStreams?: Array<{ url?: string; mimeType?: string; bitrate?: number }>;
        };
        const bestAudio = (streamJson.audioStreams || [])
          .filter((s) => s.url)
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (!bestAudio?.url) {
          return res.status(404).send('No audio stream found');
        }
        const redirected = await fetch(bestAudio.url, {
          headers,
          signal: AbortSignal.timeout(15000),
        });
        res.status(redirected.status);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (redirected.headers.get('content-type')) {
          res.setHeader('Content-Type', redirected.headers.get('content-type')!);
        }
        const buf = Buffer.from(await redirected.arrayBuffer());
        return res.send(buf);
      }

      res.status(upstream.status);
      res.setHeader('Access-Control-Allow-Origin', '*');
      const contentLength = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';
      if (contentType) res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentRange) res.setHeader('Content-Range', contentRange);
      res.setHeader('Accept-Ranges', acceptRanges);

      if (upstream.body) {
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
        return;
      }
      const arrayBuffer = await upstream.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch {
      return res.status(502).send('Audio proxy error');
    }
  });

  const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2b1920"/><stop offset="100%" stop-color="#141011"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="200" r="96" fill="none" stroke="#ED5564" stroke-width="6" stroke-opacity="0.5"/><circle cx="200" cy="200" r="22" fill="#ED5564" fill-opacity="0.75"/></svg>`;

  app.get('/api/proxy-image', async (req, res) => {
    const target = isPublicMediaUrl(String(req.query.url || ''));
    if (!target) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(FALLBACK_SVG);
    }
    try {
      const upstream = await fetch(target.toString(), {
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });
      if (!upstream.ok) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.send(FALLBACK_SVG);
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.send(buf);
    } catch {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(FALLBACK_SVG);
    }
  });

  const host = options.host || '0.0.0.0';
  const targetPort = options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : PORT);
  const distDir = options.distDir || path.resolve(currentDir, 'dist');

  if (process.env.NODE_ENV !== 'production' && !options.distDir) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return new Promise<{ port: number; server: http.Server }>((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE' && !options.port) {
        console.warn(`Port ${targetPort} in use, picking random available port...`);
        server.listen(0, host, () => {
          const addr = server.address() as any;
          console.log(`Riri Player server listening on http://${host}:${addr.port}`);
          resolve({ port: addr.port, server });
        });
      } else {
        reject(err);
      }
    });

    server.listen(targetPort, host, () => {
      const addr = server.address() as any;
      console.log(`Riri Player server listening on http://${host}:${addr.port}`);
      resolve({ port: addr.port, server });
    });
  });
}

// Auto-start if executed directly via CLI
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))
) {
  void startAppServer();
}
