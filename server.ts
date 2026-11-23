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
import { getActiveYtAccount, updateSpotifyCredentials } from './electron/ytm/credentials';
import { innerTubePost } from './electron/ytm/innertube';
import { setYtmLikeStatus, syncYtmLibrary } from './electron/ytm/library';
import type { SpotifySyncSchedule } from './src/types/music';
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

export async function startAppServer(opts: StartAppServerOptions = {}): Promise<{
  app: express.Express;
  server: http.Server;
  port: number;
}> {
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
    res.status(resolved ? 200 : 404).json(resolved || { ok: false, error: 'Stream unavailable' });
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

  // ── Image Proxy (SSRF-hardened) ────────────────────────────────────────────
  app.get('/api/proxy-image', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const parsed = parseSafeExternalUrl(rawUrl);
    if (!parsed) {
      res.status(400).end();
      return;
    }

    try {
      const upstream = await fetch(parsed.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          Referer: 'https://music.youtube.com/',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }
      const ctype = upstream.headers.get('content-type') || 'image/jpeg';
      if (!ctype.startsWith('image/')) {
        res.status(415).end();
        return;
      }
      res.setHeader('Content-Type', ctype);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch {
      res.status(502).end();
    }
  });

  // ── YouTube Music Auth & Library Routes (unchanged) ────────────────────────
  app.get('/api/auth/ytm/status', async (_req, res) => {
    res.json(await getYtmAuthStatus());
  });

  app.post('/api/auth/ytm/import-browser', async (req, res) => {
    const out = await importYtmSessionFallback(req.body || {});
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.post('/api/auth/ytm/switch', async (req, res) => {
    const accountId = String(req.body?.accountId || '');
    res.json(await switchYtmAccount(accountId));
  });

  app.post('/api/auth/ytm/logout', async (req, res) => {
    const accountId = req.body?.accountId ? String(req.body.accountId) : undefined;
    res.json(await logoutYtmAccount({ accountId }));
  });

  app.post('/api/ytmusic/library', async (req, res) => {
    const result = await syncYtmLibrary({
      gl: req.body?.gl || 'US',
      hl: req.body?.hl || 'en',
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/ytmusic/like', async (req, res) => {
    const result = await setYtmLikeStatus({
      videoId: String(req.body?.videoId || ''),
      liked: Boolean(req.body?.liked),
      gl: req.body?.gl,
      hl: req.body?.hl,
    });
    res.json(result);
  });

  app.post('/api/ytmusic/edit-playlist', async (req, res) => {
    const active = await getActiveYtAccount();
    const playlistId = String(req.body?.playlistId || '').replace(/^VL/, '').trim();
    const videoId = String(req.body?.videoId || '').trim();
    if (!active || !playlistId || !videoId) {
      res.json({ ok: false });
      return;
    }
    try {
      await innerTubePost({
        endpoint: 'browse/edit_playlist',
        body: {
          playlistId,
          actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }],
        },
        gl: String(req.body?.gl || 'US'),
        hl: String(req.body?.hl || 'en'),
      });
      res.json({ ok: true });
    } catch {
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

  // ── Lyrics & SponsorBlock ──────────────────────────────────────────────────
  app.get('/api/lyrics', async (req, res) => {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const videoId = String(req.query.videoId || '').trim();

    if (title) {
      try {
        const lrcUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(
          title,
        )}&artist_name=${encodeURIComponent(artist)}`;
        const lrRes = await fetch(lrcUrl, {
          headers: { 'User-Agent': 'RiriPlayer/1.0' },
          signal: AbortSignal.timeout(6000),
        });
        if (lrRes.ok) {
          const data = (await lrRes.json()) as {
            syncedLyrics?: string;
            plainLyrics?: string;
          };
          if (data.syncedLyrics || data.plainLyrics) {
            res.json({
              ok: true,
              syncedLyrics: data.syncedLyrics || '',
              plainLyrics: data.plainLyrics || '',
              source: 'LRCLIB',
            });
            return;
          }
        }
      } catch {
        // fall through to YouTube Music lyrics
      }
    }

    if (videoId) {
      const ytmLyrics = await fetchYtmLyrics({
        videoId,
        gl: String(req.query.gl || 'US'),
        hl: String(req.query.hl || 'en'),
      }).catch(() => ({}));
      if ('plainLyrics' in ytmLyrics && ytmLyrics.plainLyrics) {
        res.json({ ok: true, plainLyrics: ytmLyrics.plainLyrics, source: 'YouTube Music' });
        return;
      }
    }

    res.json({ ok: false, syncedLyrics: '', plainLyrics: '' });
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
import { getSpotifyStatus, logoutSpotifyAccount, resolveManualSpotifyTrackList, setSpotifySyncSchedule, syncSpotifyLibraryToYtm } from './electron/ytm/spotify';