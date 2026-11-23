import crypto from 'node:crypto';
import { extractSapisidFromCookie } from '../../src/utils/ytMusicParser';

export const ORIGIN_YOUTUBE = 'https://www.youtube.com';
export const REFERER_YOUTUBE = 'https://www.youtube.com/';
export const ORIGIN_YOUTUBE_MUSIC = 'https://music.youtube.com';
export const REFERER_YOUTUBE_MUSIC = 'https://music.youtube.com/';

export interface YouTubeClientProfile {
  clientName: string;
  clientVersion: string;
  clientId: string;
  userAgent: string;
  osName?: string;
  osVersion?: string;
  platform?: 'DESKTOP' | 'MOBILE' | 'TV' | 'TABLET';
  deviceModel?: string;
  useSignatureTimestamp?: boolean;
  supportsCookieAuthentication?: boolean;
  isEmbedded?: boolean;
  apiOrigin?: string;
}

export const YOUTUBE_CLIENTS: Record<string, YouTubeClientProfile> = {
  WEB_REMIX: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20261101.01.00',
    clientId: '67',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    osName: 'Windows',
    osVersion: '10.0',
    platform: 'DESKTOP',
    useSignatureTimestamp: true,
    supportsCookieAuthentication: true,
    apiOrigin: ORIGIN_YOUTUBE_MUSIC,
  },
  ANDROID_VR_1_65_10: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.65.10',
    clientId: '28',
    userAgent:
      'Mozilla/5.0 (Linux; Android 12; Quest 2 Build/SQ3A.220605.009.A1) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.28.32.584752528 Chrome/122.0.6261.120 Safari/537.36',
    osName: 'Android',
    osVersion: '12',
    platform: 'MOBILE',
    deviceModel: 'Quest 2',
    useSignatureTimestamp: false,
    supportsCookieAuthentication: false,
    apiOrigin: ORIGIN_YOUTUBE,
  },
  IOS: {
    clientName: 'IOS',
    clientVersion: '20.11.6',
    clientId: '5',
    userAgent:
      'com.google.ios.youtube/20.11.6 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)',
    osName: 'iOS',
    osVersion: '18.3.2',
    platform: 'MOBILE',
    deviceModel: 'iPhone16,2',
    useSignatureTimestamp: false,
    supportsCookieAuthentication: false,
    apiOrigin: ORIGIN_YOUTUBE,
  },
  ANDROID: {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    clientId: '3',
    userAgent:
      'com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US; Pixel 8 Build/UQ1A.240205.004) gzip',
    osName: 'Android',
    osVersion: '14',
    platform: 'MOBILE',
    deviceModel: 'Pixel 8',
    useSignatureTimestamp: false,
    supportsCookieAuthentication: false,
    apiOrigin: ORIGIN_YOUTUBE,
  },
  TVHTML5_SIMPLY: {
    clientName: 'TVHTML5_SIMPLY',
    clientVersion: '1.0',
    clientId: '75',
    userAgent:
      'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/6.0 TV Safari/537.36',
    platform: 'TV',
    useSignatureTimestamp: true,
    supportsCookieAuthentication: false,
    apiOrigin: ORIGIN_YOUTUBE,
  },
  MWEB: {
    clientName: 'MWEB',
    clientVersion: '2.20261101.01.00',
    clientId: '2',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
    osName: 'Android',
    osVersion: '14',
    platform: 'MOBILE',
    deviceModel: 'Pixel 8',
    useSignatureTimestamp: true,
    supportsCookieAuthentication: true,
    apiOrigin: ORIGIN_YOUTUBE,
  },
  WEB: {
    clientName: 'WEB',
    clientVersion: '2.20261101.01.00',
    clientId: '1',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    osName: 'Windows',
    osVersion: '10.0',
    platform: 'DESKTOP',
    useSignatureTimestamp: true,
    supportsCookieAuthentication: true,
    apiOrigin: ORIGIN_YOUTUBE,
  },
  TV_HTML5: {
    clientName: 'TVHTML5',
    clientVersion: '7.20261101.08.00',
    clientId: '31',
    userAgent:
      'Mozilla/5.0 (ChromiumStylePlatform; Linux x86_64; smart-tv) AppleWebKit/537.36 (KHTML, like Gecko) Cobalt/24.lts.4-devel Safari/537.36',
    platform: 'TV',
    useSignatureTimestamp: true,
    supportsCookieAuthentication: true,
    apiOrigin: ORIGIN_YOUTUBE,
  },
};

export const ANONYMOUS_STREAM_CLIENT_KEYS = [
  'ANDROID_VR_1_65_10',
  'IOS',
  'ANDROID',
  'TVHTML5_SIMPLY',
  'MWEB',
  'WEB_REMIX',
  'WEB',
];

export const AUTHED_STREAM_CLIENT_KEYS = [
  'WEB_REMIX',
  'ANDROID_VR_1_65_10',
  'IOS',
  'TVHTML5_SIMPLY',
  'WEB',
  'MWEB',
  'ANDROID',
];

export const STREAM_FALLBACK_CLIENT_KEYS = ANONYMOUS_STREAM_CLIENT_KEYS;

export function getClientOrigin(profile: YouTubeClientProfile): string {
  return profile.apiOrigin || ORIGIN_YOUTUBE;
}

export function getClientReferer(profile: YouTubeClientProfile): string {
  const origin = getClientOrigin(profile);
  return origin.endsWith('/') ? origin : `${origin}/`;
}

export function getClientApiUrl(profile: YouTubeClientProfile, endpoint: string): string {
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  const origin = getClientOrigin(profile);
  return `${origin}/youtubei/v1/${cleanEndpoint}?prettyPrint=false`;
}

function extractCookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const val = part.slice(idx + 1).trim();
      if (val) return val;
    }
  }
  return null;
}

export function hasYouTubeLoginCookie(cookie?: string | null): boolean {
  if (!cookie || typeof cookie !== 'string') return false;
  const hasSapisid = Boolean(extractSapisidFromCookie(cookie));
  const hasSessionId = Boolean(
    extractCookieValue(cookie, 'SID') ||
      extractCookieValue(cookie, '__Secure-3PSID') ||
      extractCookieValue(cookie, 'LOGIN_INFO'),
  );
  return hasSapisid && hasSessionId;
}

export function computeSapisidHash(cookie: string, origin = ORIGIN_YOUTUBE_MUSIC): string | null {
  const sapisid = extractSapisidFromCookie(cookie);
  if (!sapisid) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const cleanOrigin = origin.replace(/\/+$/, '');
  const sign = (secret: string) =>
    crypto
      .createHash('sha1')
      .update(`${timestamp} ${secret} ${cleanOrigin}`)
      .digest('hex');

  const tokens = [`SAPISIDHASH ${timestamp}_${sign(sapisid)}`];
  const sapisid1p = extractCookieValue(cookie, '__Secure-1PAPISID');
  if (sapisid1p) {
    tokens.push(`SAPISID1PHASH ${timestamp}_${sign(sapisid1p)}`);
  }
  const sapisid3p = extractCookieValue(cookie, '__Secure-3PAPISID');
  if (sapisid3p) {
    tokens.push(`SAPISID3PHASH ${timestamp}_${sign(sapisid3p)}`);
  }
  return tokens.join(' ');
}

export function extractBrandPageId(dataSyncId?: string): string | null {
  if (!dataSyncId) return null;
  const sep = dataSyncId.indexOf('||');
  if (sep <= 0) return null;
  const pageId = dataSyncId.slice(0, sep).trim();
  const userId = dataSyncId.slice(sep + 2).trim();
  if (!pageId || !userId) return null;
  return pageId;
}

export interface BuildContextOptions {
  gl?: string;
  hl?: string;
  visitorData?: string;
  dataSyncId?: string;
  poToken?: string;
  embedUrl?: string;
}

export function buildInnerTubeContext(
  profile: YouTubeClientProfile,
  opts: BuildContextOptions = {},
): Record<string, unknown> {
  const client: Record<string, unknown> = {
    clientName: profile.clientName,
    clientVersion: profile.clientVersion,
    hl: opts.hl || 'en',
    gl: (opts.gl || 'US').toUpperCase(),
    userAgent: profile.userAgent,
  };

  if (opts.visitorData) {
    client.visitorData = opts.visitorData;
  }
  if (profile.osName) {
    client.osName = profile.osName;
  }
  if (profile.osVersion) {
    client.osVersion = profile.osVersion;
  }
  if (profile.platform) {
    client.platform = profile.platform;
  }
  if (profile.deviceModel) {
    client.deviceModel = profile.deviceModel;
  }
  if (opts.poToken) {
    client.serviceIntegrityDimensions = {
      poToken: opts.poToken,
    };
  }

  const context: Record<string, unknown> = {
    client,
    user: {
      lockedSafetyMode: false,
    },
  };

  if (profile.isEmbedded) {
    context.thirdParty = {
      embedUrl: opts.embedUrl || REFERER_YOUTUBE,
    };
  }

  const brandPageId = extractBrandPageId(opts.dataSyncId);
  if (brandPageId) {
    (context.user as Record<string, unknown>).onBehalfOfUser = brandPageId;
  }

  return context;
}