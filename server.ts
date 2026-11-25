import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import express from 'express';
import {
  getYtmAuthStatus,
  importYtmSessionFallback,
  logoutYtmAccount,
  switchYtmAccount,
  YtmAuthVerificationError,
} from './electron/ytm/auth';
import {
  ORIGIN_YOUTUBE,
  ORIGIN_YOUTUBE_MUSIC,
  REFERER_YOUTUBE,
  REFERER_YOUTUBE_MUSIC,
  YOUTUBE_CLIENTS,
} from './electron/ytm/clients';
import {
  browseYtmCollection,
  fetchExploreCharts,
  fetchHomeFeed,
  fetchNextQueue,
  fetchYtmLyrics,
  fetchYtmSearchSuggestions,
  searchYtm,
} from './electron/ytm/homeSearchQueue';
import {
  configureCredentialStorage,
  getActiveYtAccount,
  updateSpotifyCredentials,
  YtAccountNotFoundError,
  YtAccountStateConflictError,
  YtVaultUnreadableError,
} from './electron/ytm/credentials';
import { innerTubePost } from './electron/ytm/innertube';
import { setYtmLikeStatus, syncYtmLibrary } from './electron/ytm/library';
import type { SpotifySyncSchedule } from './src/types/music';
import { AsyncTtlCache } from './src/utils/asyncTtlCache';
import { resolveFirstLyricsCandidate } from './src/utils/lyricsResolver';
import {
  transliterateLyrics,
} from './src/utils/transliterate';
import {
  AudioQuality,
  AdaptiveAudioFormat,
  formatQualityBadge,
  isExactFullLengthMatch,
  normalizeAudioQuality,
  pickBitrateByQuality,
  selectAudioFormatCandidates,
} from './src/utils/streamQuality';

// ──────────────────────────────────────────────────────────────────────────────
// InnerTube Stream Resolution (ArchiveTune approach)
// ──────────────────────────────────────────────────────────────────────────────

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

function extractSapisidFromCookie(cookie: string): string | null {
  const match = cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/);
  return match ? match[1] : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Player JS Deciphering (node:vm) - ArchiveTune approach
// ──────────────────────────────────────────────────────────────────────────────

interface PlayerDecipher {
  sigFn?: (s: string) => string;
  nFn?: (n: string) => string;
  sts?: number;
}

let playerScriptCache: { expiresAt: number; data: PlayerDecipher } | null = null;
let autoVisitorDataCache: { expiresAt: number; data: string } | null = null;

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

async function getPlayerDecipher(): Promise<PlayerDecipher> {
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

// ──────────────────────────────────────────────────────────────────────────────
// Signature Cipher Parsing (from ytMusicParser)
// ──────────────────────────────────────────────────────────────────────────────

function parseSignatureCipher(cipher: string): { url: string; s: string; sp: string } | null {
  try {
    const params = new URLSearchParams(cipher);
    const url = params.get('url');
    const s = params.get('s') || params.get('signature');
    const sp = params.get('sp') || 'signature';
    if (url && s) {
      return { url: decodeURIComponent(url), s: decodeURIComponent(s), sp };
    }
  } catch {
    // ignore
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Stream Resolution
// ──────────────────────────────────────────────────────────────────────────────

interface ResolvedStreamResult {
  url: string;
  qualityLabel: string;
  bitrateBps?: number;
  source: 'ytmusic' | 'mirror';
}

const resolvedStreamCache = new Map<string, { expiresAt: number; data: ResolvedStreamResult }>();

interface LyricsServerResult {
  ok: boolean;
  syncedLyrics: string;
  plainLyrics: string;
  provider: string;
  source: string;
}

const lyricsServerCache = new AsyncTtlCache<LyricsServerResult>();

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

const AUDIUS_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

interface SaavnResult {
  data?: {
    results?: Array<{
      name?: string;
      duration?: number;
      artists?: { primary?: Array<{ name?: string }> };
      downloadUrl?: Array<{ quality?: string; url?: string }>;
    }>;
  };
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

  const clients = cfg.cookie ? [webRemixClient, ...fallbackClients] : [...fallbackClients, webRemixClient];
  const decipherPromise = getPlayerDecipher();

  for (const clientInfo of clients) {
    try {
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
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;

      const json = (await res.json()) as {
        playabilityStatus?: { status?: string };
        streamingData?: {
          expiresInSeconds?: string | number;
          adaptiveFormats?: AdaptiveAudioFormat[];
        };
      };
      if (json.playabilityStatus?.status && json.playabilityStatus.status !== 'OK') continue;

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
    } catch {
      // try next InnerTube client
    }
  }

  // Fallback 2: Piped public instances
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${encodeURIComponent(videoId)}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        audioStreams?: Array<{ url?: string; bitrate?: number; mimeType?: string }>;
      };
      const candidates = (json.audioStreams || [])
        .filter((s) => s.url)
        .map((s) => ({ bitrateKbps: Math.round((s.bitrate || 128000) / 1000), ...s }));
      const picked = pickBitrateByQuality(candidates, normalizedQuality);
      if (picked?.url) {
        return {
          url: picked.url,
          qualityLabel: formatQualityBadge(picked.mimeType, picked.bitrate, normalizedQuality),
          bitrateBps: picked.bitrate,
          source: 'ytmusic',
        };
      }
    } catch {
      // try next Piped node
    }
  }

  // Fallback 3: Invidious public instances
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${encodeURIComponent(videoId)}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
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
      if (picked?.url) {
        return {
          url: picked.url,
          qualityLabel: formatQualityBadge(picked.mimeType, picked.bitrate, normalizedQuality),
          bitrateBps: picked.bitrate,
          source: 'ytmusic',
        };
      }
    } catch {
      // try next Invidious node
    }
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

  // 1. Saavn/JioSaavn
  try {
    const url = new URL('https://saavn.sumit.co/api/search/songs');
    url.searchParams.set('query', query);
    url.searchParams.set('limit', '6');
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const json = (await res.json()) as SaavnResult;
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
    }
  } catch {
    // ignore mirror failure
  }

  // 2. Audius
  for (const host of AUDIUS_HOSTS) {
    try {
      const url = new URL(`${host}/v1/tracks/search`);
      url.searchParams.set('query', query);
      url.searchParams.set('app_name', 'RiriPlayer');
      url.searchParams.set('limit', '6');
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4500) });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: AudiusTrack[] };
      for (const item of json.data || []) {
        if (!item.id || !item.title || item.is_streamable === false) continue;
        const candDur = Number(item.duration) || 0;
        if (
          isExactFullLengthMatch(title, artist, expectedDurationSec, item.title, item.user?.name || '', candDur)
        ) {
          return {
            url: `${host}/v1/tracks/${encodeURIComponent(item.id)}/stream?app_name=RiriPlayer`,
            qualityLabel: 'MP3 320kbps',
            bitrateBps: 320_000,
            source: 'mirror',
          };
        }
      }
    } catch {
      // try next Audius node
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// SSRF Protection
// ──────────────────────────────────────────────────────────────────────────────

function isPrivateOrBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  return false;
}

function parseSafeExternalUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (isPrivateOrBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function timingSafeMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sendYtmAuthError(res: express.Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'YouTube Music authentication failed.';
  if (err instanceof YtAccountNotFoundError) {
    res.status(404).json({
      ok: false,
      error: message,
      code: err.name,
      retryable: false,
    });
    return;
  }
  if (err instanceof YtAccountStateConflictError) {
    res.status(409).json({
      ok: false,
      error: message,
      code: err.name,
      retryable: true,
    });
    return;
  }
  if (err instanceof YtVaultUnreadableError) {
    res.status(503).json({
      ok: false,
      error: message,
      code: err.name,
      retryable: true,
      diagnostic: err.diagnostic,
    });
    return;
  }
  if (err instanceof YtmAuthVerificationError) {
    res.status(503).json({
      ok: false,
      error: message,
      code: err.name,
      retryable: true,
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: message,
    code: err instanceof Error && err.name ? err.name : 'YtmAuthError',
    retryable: false,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Express Server
// ──────────────────────────────────────────────────────────────────────────────

export interface StartAppServerOptions {
  distDir?: string;
  port?: number;
  host?: string;
  launchSecret?: string;
  enableViteDev?: boolean;
}

async function configureElectronCredentialStorageIfAvailable(): Promise<void> {
  try {
    const electronModule = (await import('electron')) as unknown as {
      app?: { getPath?: (name: string) => string };
      safeStorage?: {
        isEncryptionAvailable?: () => boolean;
        encryptString?: (plainText: string) => Buffer;
        decryptString?: (cipherText: Buffer) => string;
        isAsyncEncryptionAvailable?: () => Promise<boolean>;
        encryptStringAsync?: (plainText: string) => Promise<Buffer>;
        decryptStringAsync?: (
          cipherText: Buffer,
        ) => Promise<string | { result: string; shouldReEncrypt?: boolean }>;
      };
    };
    const electronApp = electronModule.app;
    const electronSafeStorage = electronModule.safeStorage;
    if (!electronApp?.getPath || !electronSafeStorage) return;
    configureCredentialStorage({
      userDataPath: electronApp.getPath('userData'),
      safeStorage: electronSafeStorage,
    });
  } catch {
    // The standalone development server has no Electron safeStorage bridge.
    // Desktop sessions remain authoritative in the Electron main process.
  }
}

export async function startAppServer(opts: StartAppServerOptions = {}): Promise<{
  app: express.Express;
  server: http.Server;
  port: number;
}> {
  await configureElectronCredentialStorageIfAvailable();
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Global permissive CORS for local desktop playback and IPC webviews
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const launchSecret = opts.launchSecret || '';

  // When running inside Electron packaged mode, enforce per-launch secret on all /api/* routes
  if (launchSecret) {
    app.use('/api', (req, res, next) => {
      const headerToken = String(req.headers['x-riri-launch-secret'] || '');
      const queryToken = String(req.query.token || '');
      const candidate = headerToken || queryToken;
      if (!candidate || !timingSafeMatch(candidate, launchSecret)) {
        res.status(403).json({ ok: false, error: 'Unauthorized internal request' });
        return;
      }
      next();
    });
  }

  // Health & Config
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'riri-player' });
  });

  // ── Hardened Range Audio Proxy (prevents CORS & SSRF) ──────────────────────
  app.get('/api/proxy-audio', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const parsed = parseSafeExternalUrl(rawUrl);
    if (!parsed) {
      res.status(400).json({ ok: false, error: 'Invalid or blocked stream URL' });
      return;
    }

    try {
      let ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
      let origin: string | undefined;
      let referer: string | undefined;

      const cParam = (parsed.searchParams.get('c') || '').toUpperCase();
      if (cParam.includes('ANDROID_MUSIC')) {
        ua = YOUTUBE_CLIENTS.ANDROID_MUSIC.userAgent;
        origin = ORIGIN_YOUTUBE_MUSIC;
        referer = REFERER_YOUTUBE_MUSIC;
      } else if (cParam.includes('ANDROID')) {
        ua = YOUTUBE_CLIENTS.ANDROID.userAgent;
      } else if (cParam.includes('IOS_MUSIC')) {
        ua = YOUTUBE_CLIENTS.IOS_MUSIC.userAgent;
        origin = ORIGIN_YOUTUBE_MUSIC;
        referer = REFERER_YOUTUBE_MUSIC;
      } else if (cParam.includes('IOS')) {
        ua = YOUTUBE_CLIENTS.IOS.userAgent;
      } else if (cParam.includes('TV')) {
        ua = YOUTUBE_CLIENTS.TV_HTML5.userAgent;
        origin = ORIGIN_YOUTUBE;
        referer = REFERER_YOUTUBE;
      } else if (cParam.includes('WEB_REMIX') || cParam.includes('YTMUSIC')) {
        ua = YOUTUBE_CLIENTS.WEB_REMIX.userAgent;
        origin = ORIGIN_YOUTUBE_MUSIC;
        referer = REFERER_YOUTUBE_MUSIC;
      } else if (parsed.hostname.includes('googlevideo.com')) {
        // Default for direct googlevideo.com URLs (from /api/ytmusic/resolve-stream)
        ua = YOUTUBE_CLIENTS.WEB_REMIX.userAgent;
        origin = ORIGIN_YOUTUBE_MUSIC;
        referer = REFERER_YOUTUBE_MUSIC;
      }

      const headers: Record<string, string> = {
        'User-Agent': ua,
      };
      if (origin) headers['Origin'] = origin;
      if (referer) headers['Referer'] = referer;
      if (req.headers.range) {
        headers['Range'] = String(req.headers.range);
      }

      const upstream = await fetch(parsed.toString(), {
        headers,
        signal: AbortSignal.timeout(60000),
      });

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).end();
        return;
      }

      res.status(upstream.status);
      res.setHeader('Access-Control-Allow-Origin', '*');
      for (const h of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'cache-control',
      ]) {
        const val = upstream.headers.get(h);
        if (val) res.setHeader(h, val);
      }

      if (!upstream.body) {
        res.end();
        return;
      }

      const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      stream.on('error', (err) => {
        console.error('[Proxy Audio] Upstream stream error:', err.message);
        if (!res.headersSent) {
          res.status(502).send('Upstream stream error');
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      console.error('[Proxy Audio] Error:', err);
      if (!res.headersSent) {
        res.status(502).json({ ok: false, error: 'Upstream audio stream error' });
      } else {
        res.end();
      }
    }
  });

  // ── YouTube Music Stream Resolver & Range-Aware Audio Proxy ────────────────
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

    let resolved = videoId
      ? await resolveYouTubeAudioStream(videoId, cfg, quality, durationSec)
      : null;

    if (!resolved && title) {
      resolved = await resolveFullLengthDirectMirror(title, artist, durationSec, quality);
    }

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
        signal: AbortSignal.timeout(60000),
      });
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).send('Upstream audio stream error');
      }
      res.status(upstream.status);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-ArchiveTune-Quality', resolved.qualityLabel);
      const ct = upstream.headers.get('content-type') || 'audio/mp4';
      const cl = upstream.headers.get('content-length');
      const cr = upstream.headers.get('content-range');
      const ar = upstream.headers.get('accept-ranges') || 'bytes';
      res.setHeader('Content-Type', ct);
      if (cl) res.setHeader('Content-Length', cl);
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Accept-Ranges', ar);
      if (upstream.body) {
        const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
        stream.on('error', (err) => {
          console.error('[Stream Proxy] Upstream stream error:', err.message);
          if (!res.headersSent) {
            res.status(502).send('Upstream stream error');
          } else {
            res.end();
          }
        });
        stream.pipe(res);
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.send(buf);
    } catch (err) {
      console.error('[Stream Proxy] Error:', err);
      if (!res.headersSent) {
        return res.status(502).send('Failed to stream audio');
      }
      res.end();
    }
  });

  app.get('/api/ytmusic/resolve-stream', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    const quality = normalizeAudioQuality(String(req.query.quality || 'HIGH'));
    const cfg = getYtReqConfig(req);
    const durationSec = Number(req.query.durationSec || '0') || 0;
    const forceRefresh = req.query.refresh === '1';

    if (forceRefresh) {
      const cacheKey = `${videoId}::${quality}::${cfg.gl || 'US'}::${Boolean(cfg.cookie)}`;
      resolvedStreamCache.delete(cacheKey);
    }

    const resolved = await resolveYouTubeAudioStream(videoId, cfg, quality, durationSec);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(resolved ? 200 : 404).json(
      resolved
        ? { ok: true, videoId, ...resolved }
        : { ok: false, videoId, error: 'Stream unavailable' },
    );
  });

  // ── Stream Info (for frontend to get stream URL + fallback info) ───────────
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

    let resolved = videoId
      ? await resolveYouTubeAudioStream(videoId, cfg, quality, durationSec)
      : null;

    if (!resolved && title) {
      resolved = await resolveFullLengthDirectMirror(title, artist, durationSec, quality);
    }

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

    // Collect alternate videoIds for youtube embed fallback
    const alternateVideoIds: string[] = [];
    if (title) {
      const altHits = await searchYtm({
        query: `${title} ${artist} audio`.trim(),
        filter: 'songs',
        gl: cfg.gl,
        hl: cfg.hl,
      });
      for (const hit of altHits.tracks) {
        if (hit.ytMusicVideoId && hit.ytMusicVideoId !== videoId && !alternateVideoIds.includes(hit.ytMusicVideoId)) {
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

  // ── Image Proxy (SSRF-hardened + highest-quality artwork upgrade) ─────────
  app.get('/api/proxy-image', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const parsed = parseSafeExternalUrl(rawUrl);
    if (!parsed) {
      res.status(400).end();
      return;
    }

    const originalStr = parsed.toString();
    const candidateUrls: string[] = [];
    if (/^https?:\/\/(lh3\.googleusercontent\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com)\//i.test(originalStr)) {
      let upgraded = originalStr;
      if (/=w\d+-h\d+/i.test(upgraded)) {
        upgraded = upgraded.replace(/=w\d+-h\d+([^?\s]*)/i, (_m, rest) => {
          const updatedRest = String(rest || '').replace(/-l\d+/i, '-l100');
          return `=w1200-h1200${updatedRest}`;
        });
      } else if (/=s\d+/i.test(upgraded)) {
        upgraded = upgraded.replace(/=s\d+/i, '=s1200');
      }
      candidateUrls.push(upgraded);
      if (upgraded !== originalStr) candidateUrls.push(originalStr);
    } else if (/^https?:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/[^/]+\/(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)/i.test(originalStr)) {
      candidateUrls.push(
        originalStr.replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)/i, '/maxresdefault.$2'),
        originalStr.replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)/i, '/sddefault.$2'),
        originalStr.replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)/i, '/hqdefault.$2'),
      );
      if (!candidateUrls.includes(originalStr)) candidateUrls.push(originalStr);
    } else {
      candidateUrls.push(originalStr);
    }

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      Referer: 'https://music.youtube.com/',
    };

    try {
      let lastStatus = 502;
      for (const targetUrl of candidateUrls) {
        const safeTarget = parseSafeExternalUrl(targetUrl);
        if (!safeTarget) continue;
        const upstream = await fetch(safeTarget.toString(), {
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (!upstream.ok) {
          lastStatus = upstream.status;
          continue;
        }
        const ctype = upstream.headers.get('content-type') || 'image/jpeg';
        if (!ctype.startsWith('image/')) {
          lastStatus = 415;
          continue;
        }
        res.setHeader('Content-Type', ctype);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.send(buf);
        return;
      }
      res.status(lastStatus).end();
    } catch {
      res.status(502).end();
    }
  });

  // ── YouTube Music Auth & Library Routes (unchanged) ────────────────────────
  app.get('/api/auth/ytm/status', async (_req, res) => {
    try {
      res.json(await getYtmAuthStatus());
    } catch (err) {
      sendYtmAuthError(res, err);
    }
  });

  app.post('/api/auth/ytm/import-browser', async (req, res) => {
    try {
      const safePayload = {
        cookieHeader:
          typeof req.body?.cookieHeader === 'string' ? req.body.cookieHeader : '',
        visitorData:
          typeof req.body?.visitorData === 'string' ? req.body.visitorData : undefined,
        dataSyncId:
          typeof req.body?.dataSyncId === 'string' ? req.body.dataSyncId : undefined,
        accountIndex:
          typeof req.body?.accountIndex === 'number' ? req.body.accountIndex : undefined,
      };
      const out = await importYtmSessionFallback(safePayload);
      res.status(out.ok ? 200 : 400).json(out);
    } catch (err) {
      sendYtmAuthError(res, err);
    }
  });

  app.post('/api/auth/ytm/switch', async (req, res) => {
    try {
      const accountId = String(req.body?.accountId || '');
      res.json(await switchYtmAccount(accountId));
    } catch (err) {
      sendYtmAuthError(res, err);
    }
  });

  app.post('/api/auth/ytm/logout', async (req, res) => {
    try {
      const accountId = req.body?.accountId ? String(req.body.accountId) : undefined;
      res.json(await logoutYtmAccount({ accountId }));
    } catch (err) {
      sendYtmAuthError(res, err);
    }
  });

  app.post('/api/ytmusic/library', async (req, res) => {
    try {
      const result = await syncYtmLibrary({
        gl: req.body?.gl || 'US',
        hl: req.body?.hl || 'en',
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      sendYtmAuthError(res, err);
    }
  });

  app.post('/api/ytmusic/like', async (req, res) => {
    try {
      const result = await setYtmLikeStatus({
        videoId: String(req.body?.videoId || ''),
        liked: Boolean(req.body?.liked),
        gl: req.body?.gl,
        hl: req.body?.hl,
        expectedAccountId:
          typeof req.body?.expectedAccountId === 'string'
            ? req.body.expectedAccountId
            : undefined,
      });
      res.json(result);
    } catch (err) {
      sendYtmAuthError(res, err);
    }
  });

  app.post('/api/ytmusic/edit-playlist', async (req, res) => {
    const playlistId = String(req.body?.playlistId || '').replace(/^VL/, '').trim();
    const videoId = String(req.body?.videoId || '').trim();
    try {
      const active = await getActiveYtAccount();
      const expectedAccountId =
        typeof req.body?.expectedAccountId === 'string'
          ? req.body.expectedAccountId
          : undefined;
      if (
        !active ||
        !playlistId ||
        !videoId ||
        (expectedAccountId && expectedAccountId !== active.id)
      ) {
        res.json({ ok: false });
        return;
      }
      await innerTubePost({
        endpoint: 'browse/edit_playlist',
        body: {
          playlistId,
          actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }],
        },
        gl: String(req.body?.gl || 'US'),
        hl: String(req.body?.hl || 'en'),
        requireAuth: true,
        accountOverride: active,
      });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof YtVaultUnreadableError || err instanceof YtAccountNotFoundError) {
        sendYtmAuthError(res, err);
        return;
      }
      res.json({ ok: false });
    }
  });

  // ── YouTube Music Browse/Search/Next Routes (unchanged) ────────────────────
  app.get('/api/ytmusic/home', async (req, res) => {
    try {
      const data = await fetchHomeFeed({
        params: req.query.params ? String(req.query.params) : undefined,
        continuation: req.query.continuation ? String(req.query.continuation) : undefined,
        gl: String(req.query.gl || 'US'),
        hl: String(req.query.hl || 'en'),
      });
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Home error' });
    }
  });

  app.get('/api/ytmusic/charts', async (req, res) => {
    try {
      const data = await fetchExploreCharts({
        gl: String(req.query.gl || 'US'),
        hl: String(req.query.hl || 'en'),
      });
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Charts error' });
    }
  });

  app.get('/api/ytmusic/browse', async (req, res) => {
    try {
      const browseId = String(req.query.browseId || '').trim();
      const continuation = req.query.continuation ? String(req.query.continuation) : undefined;
      if (!browseId && !continuation) {
        res.status(400).json({ ok: false, error: 'Missing browseId' });
        return;
      }
      const data = await browseYtmCollection({
        browseId,
        continuation,
        gl: String(req.query.gl || 'US'),
        hl: String(req.query.hl || 'en'),
      });
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Browse error' });
    }
  });

  app.get('/api/ytmusic/search', async (req, res) => {
    try {
      const data = await searchYtm({
        query: String(req.query.q || ''),
        filter: String(req.query.filter || 'songs'),
        continuation: req.query.continuation ? String(req.query.continuation) : undefined,
        gl: String(req.query.gl || 'US'),
        hl: String(req.query.hl || 'en'),
      });
      res.json({ ok: true, ...data });
    } catch {
      res.json({ ok: true, tracks: [], cards: [] });
    }
  });

  app.get('/api/search', async (req, res) => {
    try {
      const data = await searchYtm({
        query: String(req.query.q || ''),
        filter: String(req.query.filter || 'songs'),
        gl: String(req.query.gl || 'US'),
        hl: String(req.query.hl || 'en'),
      });
      res.json({ ok: true, tracks: data.tracks, cards: data.cards });
    } catch {
      res.json({ ok: true, tracks: [], cards: [] });
    }
  });

  app.get('/api/ytmusic/suggestions', async (req, res) => {
    const data = await fetchYtmSearchSuggestions({
      query: String(req.query.q || ''),
      gl: String(req.query.gl || 'US'),
      hl: String(req.query.hl || 'en'),
    });
    res.json({ ok: true, suggestions: data.queries, items: data.items });
  });

  app.get('/api/ytmusic/next', async (req, res) => {
    try {
      const result = await fetchNextQueue({
        videoId: req.query.videoId ? String(req.query.videoId) : undefined,
        playlistId: req.query.playlistId ? String(req.query.playlistId) : undefined,
        params: req.query.params ? String(req.query.params) : undefined,
        continuation: req.query.continuation ? String(req.query.continuation) : undefined,
        gl: String(req.query.gl || 'US'),
        hl: String(req.query.hl || 'en'),
      });
      res.json({ ok: Boolean(result), result });
    } catch {
      res.json({ ok: false, result: null });
    }
  });

  // ── Spotify Session & Mapping Routes (unchanged) ───────────────────────────
  app.get('/api/spotify/status', (_req, res) => {
    res.json({ ok: true, connection: getSpotifyStatus() });
  });

  app.post('/api/spotify/sync', async (req, res) => {
    const out = await syncSpotifyLibraryToYtm({
      gl: req.body?.gl || 'US',
      hl: req.body?.hl || 'en',
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.get('/api/spotify/sync-progress', (_req, res) => {
    res.json({ ok: true, progress: getSpotifySyncProgress() });
  });

  app.post('/api/spotify/import-playlist', async (req, res) => {
    const out = await resolveManualSpotifyTrackList({
      input: String(req.body?.input || ''),
      gl: req.body?.gl || 'US',
      hl: req.body?.hl || 'en',
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.post('/api/spotify/schedule', (req, res) => {
    const schedule = String(req.body?.syncSchedule || 'MANUAL') as SpotifySyncSchedule;
    res.json({ ok: true, connection: setSpotifySyncSchedule(schedule) });
  });

  app.post('/api/spotify/logout', async (_req, res) => {
    await logoutSpotifyAccount();
    res.json({ ok: true, connection: null });
  });

  app.post('/api/spotify/dismiss-unmatched', async (req, res) => {
    const trackId = String(req.body?.trackId || '');
    const status = await getSpotifyStatus();
    if (!status) {
      res.json({ ok: true, connection: null });
      return;
    }
    const remaining = (status.unmatchedTracks || []).filter((t) => t.id !== trackId);
    const updated = await updateSpotifyCredentials({ unmatchedTracks: remaining });
    res.json({ ok: true, connection: updated });
  });

  // ── Multi-Provider Lyrics (ArchiveTune Architecture) ────────────────────────
  function formatLrcTimestamp(ms: number): string {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const hundredths = Math.floor((ms % 1000) / 10);
    return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`;
  }

  function providerTimeoutSignal(
    timeoutMs: number,
    parentSignal?: AbortSignal,
  ): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return parentSignal
      ? AbortSignal.any([parentSignal, timeoutSignal])
      : timeoutSignal;
  }

  async function fetchLrclibProvider(
    title: string,
    artist: string,
    durationSec?: number,
    signal?: AbortSignal,
  ) {
    const lrcUrl = new URL('https://lrclib.net/api/get');
    lrcUrl.searchParams.set('track_name', title);
    lrcUrl.searchParams.set('artist_name', artist);
    if (durationSec && durationSec > 0) {
      lrcUrl.searchParams.set('duration', String(Math.round(durationSec)));
    }
    const res = await fetch(lrcUrl.toString(), {
      headers: { 'User-Agent': 'RiriPlayer/1.2 (ArchiveTune-Engine)' },
      signal: providerTimeoutSignal(6000, signal),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string };
    if (data.syncedLyrics || data.plainLyrics) {
      return {
        syncedLyrics: data.syncedLyrics || '',
        plainLyrics: data.plainLyrics || '',
        provider: 'lrclib',
        source: 'LRCLIB',
      };
    }
    return null;
  }

  async function fetchYouLyPlusProvider(
    title: string,
    artist: string,
    signal?: AbortSignal,
  ) {
    const baseUrls = [
      'https://lyricsplus.prjktla.my.id/',
      'https://lyricsplus.atomix.one/',
    ];
    for (const base of baseUrls) {
      try {
        const url = `${base}v2/lyrics/get?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'ArchiveTune' },
          signal: providerTimeoutSignal(5000, signal),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          lyrics?: Array<{ time?: number; text?: string }>;
        };
        if (Array.isArray(data?.lyrics) && data.lyrics.length > 0) {
          const lrcLines = data.lyrics
            .filter((l) => typeof l.time === 'number' && typeof l.text === 'string')
            .map((l) => `${formatLrcTimestamp(l.time!)} ${l.text!.trim()}`)
            .join('\n');
          const plainLines = data.lyrics
            .map((l) => l.text?.trim() || '')
            .filter(Boolean)
            .join('\n');
          return {
            syncedLyrics: lrcLines,
            plainLyrics: plainLines,
            provider: 'youlyplus',
            source: 'YouLy+',
          };
        }
      } catch {
        // try next base URL
      }
    }
    return null;
  }

  async function fetchKuGouProvider(
    title: string,
    artist: string,
    durationSec?: number,
    signal?: AbortSignal,
  ) {
    try {
      const kw = `${title} ${artist}`.trim();
      const sUrl = `https://mobileservice.kugou.com/api/v3/search/song?version=9108&plat=0&pagesize=8&showtype=0&keyword=${encodeURIComponent(kw)}`;
      const sRes = await fetch(sUrl, {
        signal: providerTimeoutSignal(6000, signal),
      });
      if (!sRes.ok) return null;
      const sData = (await sRes.json()) as {
        data?: { info?: Array<{ hash: string; duration: number }> };
      };
      const songs = sData?.data?.info || [];
      if (songs.length === 0) return null;

      for (const song of songs.slice(0, 4)) {
        if (durationSec && durationSec > 0 && Math.abs(song.duration - durationSec) > 15) {
          continue;
        }
        try {
          const cUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${song.hash}`;
          const cRes = await fetch(cUrl, {
            signal: providerTimeoutSignal(4000, signal),
          });
          if (!cRes.ok) continue;
          const cData = (await cRes.json()) as {
            candidates?: Array<{ id: string | number; accesskey: string }>;
          };
          const cand = cData?.candidates?.[0];
          if (!cand) continue;

          const dUrl = `https://lyrics.kugou.com/download?ver=1&client=pc&id=${cand.id}&accesskey=${cand.accesskey}&fmt=lrc&charset=utf8`;
          const dRes = await fetch(dUrl, {
            signal: providerTimeoutSignal(5000, signal),
          });
          if (!dRes.ok) continue;
          const dData = (await dRes.json()) as { content?: string };
          if (dData?.content) {
            const lrc = Buffer.from(dData.content, 'base64').toString('utf8');
            if (lrc.length > 20) {
              return {
                syncedLyrics: lrc,
                plainLyrics: '',
                provider: 'kugou',
                source: 'KuGou Music',
              };
            }
          }
        } catch {
          // try next candidate
        }
      }
    } catch {
      // KuGou error
    }
    return null;
  }

  async function fetchSimpMusicProvider(
    videoId: string,
    signal?: AbortSignal,
  ) {
    if (!videoId) return null;
    try {
      const url = `https://api-lyrics.simpmusic.org/v1/${videoId}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SimpMusicLyrics/1.0', Accept: 'application/json' },
        signal: providerTimeoutSignal(6000, signal),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        success?: boolean;
        data?: Array<{ syncedLyrics?: string; plainLyrics?: string; plainLyric?: string }>;
      };
      if (data?.success && Array.isArray(data.data) && data.data.length > 0) {
        const item = data.data[0];
        const plainLyrics = item.plainLyrics || item.plainLyric || '';
        if (item.syncedLyrics || plainLyrics) {
          return {
            syncedLyrics: item.syncedLyrics || '',
            plainLyrics,
            provider: 'simpmusic',
            source: 'SimpMusic',
          };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  async function fetchServerLyricsProvider(
    provider: string,
    title: string,
    artist: string,
    videoId: string,
    duration: number | undefined,
    gl: string,
    hl: string,
    signal?: AbortSignal,
  ): Promise<LyricsServerResult | null> {
    if (provider === 'lrclib' && title) {
      const result = await fetchLrclibProvider(title, artist, duration, signal);
      if (result && (result.syncedLyrics || result.plainLyrics)) {
        return { ok: true, ...result };
      }
    } else if (provider === 'youlyplus' && title) {
      const result = await fetchYouLyPlusProvider(title, artist, signal);
      if (result && (result.syncedLyrics || result.plainLyrics)) {
        return { ok: true, ...result };
      }
    } else if (provider === 'kugou' && title) {
      const result = await fetchKuGouProvider(title, artist, duration, signal);
      if (result && result.syncedLyrics) {
        return { ok: true, ...result };
      }
    } else if (provider === 'simpmusic' && videoId) {
      const result = await fetchSimpMusicProvider(videoId, signal);
      if (result && (result.syncedLyrics || result.plainLyrics)) {
        return { ok: true, ...result };
      }
    } else if (provider === 'ytm' && videoId) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const abortResult = new Promise<Record<string, never>>((resolve) => {
        if (!signal) return;
        if (signal.aborted) {
          resolve({});
          return;
        }
        signal.addEventListener('abort', () => resolve({}), { once: true });
      });
      const ytmLyrics = await Promise.race([
        fetchYtmLyrics({ videoId, gl, hl, signal }).catch(() => ({})),
        new Promise<Record<string, never>>((resolve) => {
          timeout = setTimeout(() => resolve({}), 7000);
        }),
        abortResult,
      ]);
      if (timeout) clearTimeout(timeout);
      if ('plainLyrics' in ytmLyrics && ytmLyrics.plainLyrics) {
        return {
          ok: true,
          syncedLyrics: '',
          plainLyrics: ytmLyrics.plainLyrics,
          provider: 'ytm',
          source: 'YouTube Music',
        };
      }
    }
    return null;
  }

  async function fetchFirstServerLyricsProvider(
    providers: string[],
    title: string,
    artist: string,
    videoId: string,
    duration: number | undefined,
    gl: string,
    hl: string,
    signal?: AbortSignal,
    onLateUpgrade?: (result: LyricsServerResult) => void,
  ): Promise<LyricsServerResult | null> {
    if (providers.length === 0) return null;

    const tasks = providers.map((provider, index) => ({
      rank: index,
      promise: (async () => {
        // Preserve the configured provider priority with a small head start
        // instead of waiting for each provider sequentially.
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, index * 120));
        }
        return await fetchServerLyricsProvider(
          provider,
          title,
          artist,
          videoId,
          duration,
          gl,
          hl,
          signal,
        );
      })(),
    }));
    return await resolveFirstLyricsCandidate(tasks, {
      getPriority: (candidate, fallbackRank) => {
        const providerIndex = providers.indexOf(candidate.provider);
        return providerIndex >= 0 ? providerIndex : fallbackRank;
      },
      onLateUpgrade,
    });
  }

  app.get('/api/lyrics', async (req, res) => {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const videoId = String(req.query.videoId || '').trim();
    const duration = req.query.duration ? parseFloat(String(req.query.duration)) : undefined;
    const gl = String(req.query.gl || 'US');
    const hl = String(req.query.hl || 'en');
    const providersParam = String(
      req.query.providers || 'lrclib,youlyplus,kugou,simpmusic,ytm',
    );
    const enabledProviders = Array.from(
      new Set(
        providersParam
          .split(',')
          .map((provider) => provider.trim().toLowerCase())
          .filter((provider) =>
            ['lrclib', 'youlyplus', 'kugou', 'simpmusic', 'ytm'].includes(provider),
          ),
      ),
    );
    const cacheKey = [
      videoId || `${title}|${artist}|${Math.round(duration || 0)}`,
      enabledProviders.join(','),
      gl,
      hl,
    ].join('::');
    const forceRefresh = String(req.query.refresh || '') === '1';
    const requestController = new AbortController();
    const abortProviders = () => requestController.abort();
    req.once('aborted', abortProviders);
    res.once('close', () => {
      if (!res.writableEnded) abortProviders();
    });
    const ttlForResult = (result: LyricsServerResult): number => {
      if (!result.ok) return 5 * 60 * 1000;
      return result.syncedLyrics ? 6 * 60 * 60 * 1000 : 2 * 60 * 1000;
    };

    try {
      const entry = await lyricsServerCache.resolve(
        cacheKey,
        ttlForResult,
        async (generation) =>
          (await fetchFirstServerLyricsProvider(
            enabledProviders,
            title,
            artist,
            videoId,
            duration,
            gl,
            hl,
            requestController.signal,
            (upgraded) => {
              if (upgraded.syncedLyrics) {
                // A late result from an older request must not overwrite a
                // newer forced refresh for the same track.
                lyricsServerCache.set(
                  cacheKey,
                  upgraded,
                  ttlForResult,
                  generation,
                );
              }
            },
          )) || {
            ok: false,
            syncedLyrics: '',
            plainLyrics: '',
            provider: 'none',
            source: '',
          },
        { forceRefresh },
      );
      if (requestController.signal.aborted) return;
      res.setHeader('X-Lyrics-Cache', entry.status);
      res.json(entry.value);
    } catch (error) {
      if (!requestController.signal.aborted) {
        res.status(500).json({
          ok: false,
          syncedLyrics: '',
          plainLyrics: '',
          provider: 'none',
          source: '',
          error: error instanceof Error ? error.message : 'Lyrics lookup failed.',
        });
      }
    } finally {
      req.off('aborted', abortProviders);
    }
  });

  app.get('/api/sponsorblock', async (req, res) => {
    const videoId = String(req.query.videoId || '').trim();
    if (!videoId) {
      res.json({ segments: [] });
      return;
    }
    try {
      const sbUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(
        videoId,
      )}&categories=${encodeURIComponent(
        JSON.stringify(['sponsor', 'intro', 'outro', 'music_offtopic', 'selfpromo']),
      )}`;
      const sbRes = await fetch(sbUrl, { signal: AbortSignal.timeout(5000) });
      if (!sbRes.ok) {
        res.json({ segments: [] });
        return;
      }
      const data = (await sbRes.json()) as Array<{
        segment?: [number, number];
        category?: string;
      }>;
      const segments = (Array.isArray(data) ? data : [])
        .filter((d) => Array.isArray(d.segment) && d.segment.length === 2)
        .map((d) => ({
          startSec: Number(d.segment![0]),
          endSec: Number(d.segment![1]),
          category: d.category || 'music_offtopic',
        }));
      res.json({ segments });
    } catch {
      res.json({ segments: [] });
    }
  });

  app.post('/api/translate-lyrics', async (req, res) => {
    const lines = Array.isArray(req.body?.lines) ? (req.body.lines as string[]) : [];
    const targetLang = String(req.body?.targetLang || 'en').trim();
    if (lines.length === 0) {
      res.json({ ok: true, translations: [] });
      return;
    }
    try {
      const joined = lines.slice(0, 120).join('\n');
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
        targetLang,
      )}&dt=t&q=${encodeURIComponent(joined)}`;
      const trRes = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!trRes.ok) {
        res.json({ ok: false, translations: [] });
        return;
      }
      const parsed = (await trRes.json()) as unknown[];
      const chunks = Array.isArray(parsed?.[0]) ? (parsed[0] as Array<[string]>) : [];
      const combined = chunks.map((c) => c?.[0] || '').join('');
      res.json({ ok: true, translations: combined.split('\n') });
    } catch {
      res.json({ ok: false, translations: [] });
    }
  });

  app.post('/api/transliterate-lyrics', async (req, res) => {
    const lines = Array.isArray(req.body?.lines) ? (req.body.lines as string[]) : [];
    if (lines.length === 0) {
      res.json({ ok: true, transliteration: [], hasAlternateLanguage: false });
      return;
    }
    try {
      const joined = lines.slice(0, 120).join('\n');
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=rm&q=${encodeURIComponent(joined)}`;
      const trRes = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (trRes.ok) {
        const parsed = (await trRes.json()) as unknown[];
        const detectedLang = typeof parsed?.[2] === 'string' ? parsed[2] : '';
        const isAlreadyEnglish = detectedLang.toLowerCase().startsWith('en');

        // Check for romanized lyrics block (dt=rm gives transliterated pronunciation)
        let romanizedLines: string[] | null = null;
        if (Array.isArray(parsed?.[0])) {
          const blocks = parsed[0] as unknown[];
          // The last block often contains [null, null, null, "Romanized string"]
          for (let i = blocks.length - 1; i >= 0; i--) {
            const block = blocks[i] as unknown[];
            if (Array.isArray(block) && typeof block[3] === 'string' && block[3].trim()) {
              romanizedLines = block[3].split('\n').map((l) => l.trim());
              break;
            }
          }

          // If no romanized block, use translated English lines
          if (!romanizedLines || romanizedLines.length === 0) {
            const translatedText = blocks
              .filter((b) => Array.isArray(b) && typeof (b as unknown[])[0] === 'string')
              .map((b) => (b as unknown[])[0] as string)
              .join('');
            if (translatedText.trim()) {
              romanizedLines = translatedText.split('\n').map((l) => l.trim());
            }
          }
        }

        if (romanizedLines && romanizedLines.length > 0) {
          // Pad or align to original line count if necessary
          const finalLines = lines.map((original, idx) => romanizedLines![idx] || original);
          res.json({
            ok: true,
            transliteration: finalLines,
            hasAlternateLanguage: !isAlreadyEnglish,
            detectedLang,
          });
          return;
        }
      }

      // Offline fallback: use local regex transliteration
      const localTransliterated = transliterateLyrics(lines);
      res.json({
        ok: true,
        transliteration: localTransliterated,
        hasAlternateLanguage: true,
      });
    } catch {
      // Local fallback on network error
      const localTransliterated = transliterateLyrics(lines);
      res.json({
        ok: true,
        transliteration: localTransliterated,
        hasAlternateLanguage: true,
      });
    }
  });

  app.post('/api/scrobble', async (req, res) => {
    const token = String(req.body?.listenBrainzToken || '').trim();
    const title = String(req.body?.title || '').trim();
    const artist = String(req.body?.artist || '').trim();
    const album = String(req.body?.album || '').trim();
    if (!token || !title || !artist) {
      res.json({ ok: false });
      return;
    }
    try {
      const lbRes = await fetch('https://api.listenbrainz.org/1/submit-listens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          listen_type: 'single',
          payload: [
            {
              listened_at: Math.floor(Date.now() / 1000),
              track_metadata: {
                artist_name: artist,
                track_name: title,
                ...(album ? { release_name: album } : {}),
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(6000),
      });
      res.json({ ok: lbRes.ok });
    } catch {
      res.json({ ok: false });
    }
  });

  // ── Static / Vite Frontend Serving ─────────────────────────────────────────
  const isProd = process.env.NODE_ENV === 'production' || Boolean(opts.distDir);
  if (!isProd && opts.enableViteDev !== false) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = opts.distDir || path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const host = opts.host || (opts.distDir ? '127.0.0.1' : '0.0.0.0');
  const listenPort = opts.port !== undefined ? opts.port : Number(process.env.PORT || 3000);

  return await new Promise((resolve, reject) => {
    const server = app.listen(listenPort, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
      resolve({ app, server, port: actualPort });
    });
    server.on('error', reject);
  });
}

// Run standalone server when launched via `tsx server.ts` or `node server.js`
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))
) {
  void startAppServer({
    port: Number(process.env.PORT || 3000),
    host: '0.0.0.0',
    enableViteDev: process.env.NODE_ENV !== 'production',
  }).then(({ port }) => {
    console.log(`Riri Player server running on http://localhost:${port}`);
  });
}

// Need to import these from electron/ytm/spotify
import { getSpotifyStatus, getSpotifySyncProgress, logoutSpotifyAccount, resolveManualSpotifyTrackList, setSpotifySyncSchedule, syncSpotifyLibraryToYtm } from './electron/ytm/spotify';