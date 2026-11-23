import crypto from 'node:crypto';
import http from 'node:http';
import {
  ANONYMOUS_STREAM_CLIENT_KEYS,
  AUTHED_STREAM_CLIENT_KEYS,
  hasYouTubeLoginCookie,
  YOUTUBE_CLIENTS,
} from './clients';
import { getActiveYtAccount } from './credentials';
import { ensureVisitorData, getInnertubeClient, innerTubePost } from './innertube';
import { resolveFallbackPluginStream } from './pluginFallback';

export interface ResolveStreamPayload {
  videoId: string;
  title?: string;
  artist?: string;
  quality?: string;
  gl?: string;
  hl?: string;
  expectedDurationSec?: number;
  forceRefresh?: boolean;
  excludeClients?: string[];
}

export interface ResolvedAudioStream {
  url: string;
  streamUrl: string;
  audioUrl: string;
  mimeType: string;
  bitrate: number;
  audioChannels?: number;
  sampleRate?: number;
  contentLength?: number;
  loudnessDb?: number;
  durationSec?: number;
  clientUsed: string;
  expiresAt: number;
  headers?: Record<string, string>;
}

interface CachedStreamEntry {
  stream: ResolvedAudioStream;
  upstreamUrl: string;
  upstreamHeaders: Record<string, string>;
  payload: ResolveStreamPayload;
}

interface RawAdaptiveFormat {
  itag?: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  mimeType?: string;
  bitrate?: number;
  averageBitrate?: number;
  audioQuality?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  contentLength?: string;
  approxDurationMs?: string;
  loudnessDb?: number;
  isDrc?: boolean;
}

interface PlayerApiResponse {
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
  streamingData?: {
    expiresInSeconds?: string;
    adaptiveFormats?: RawAdaptiveFormat[];
    formats?: RawAdaptiveFormat[];
    hlsManifestUrl?: string;
  };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
  };
}

const streamCache = new Map<string, CachedStreamEntry>();
let localStreamProxyPromise: Promise<string> | null = null;

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  );
}

/**
 * Local loopback HTTP range proxy that fetches audio streams via Node's fetch and
 * serves CORS + byte-range responses to Chromium's <audio crossOrigin="anonymous"> element.
 */
function ensureLocalStreamProxy(): Promise<string> {
  if (localStreamProxyPromise) return localStreamProxyPromise;

  localStreamProxyPromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      setCorsHeaders(res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      const abortController = new AbortController();
      let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      res.on('close', () => {
        if (!res.writableFinished) {
          abortController.abort();
          if (activeReader) {
            void activeReader.cancel().catch(() => undefined);
          }
        }
      });

      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (reqUrl.pathname !== '/stream') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        const key = reqUrl.searchParams.get('key') || '';
        let entry = streamCache.get(key);
        if (!entry) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Stream cache miss or expired');
          return;
        }

        const buildUpstreamHeaders = (baseHeaders: Record<string, string>) => {
          const h: Record<string, string> = { ...baseHeaders };
          if (req.headers.range) {
            h['Range'] = req.headers.range;
          }
          return h;
        };

        let upstreamRes = await fetch(entry.upstreamUrl, {
          method: req.method,
          headers: buildUpstreamHeaders(entry.upstreamHeaders),
          signal: abortController.signal,
        });

        if (upstreamRes.status === 403 && !entry.stream.clientUsed.startsWith('PLUGIN:')) {
          void upstreamRes.body?.cancel().catch(() => undefined);
          const blockedClient = entry.stream.clientUsed.split(':')[0];
          const nextExclude = Array.from(
            new Set([...(entry.payload.excludeClients || []), blockedClient]),
          );
          console.warn(
            `[YTM Stream Proxy] Upstream 403 on ${blockedClient} for ${entry.payload.videoId}; failing over...`,
          );
          try {
            await resolveYtmAudioStream({
              ...entry.payload,
              forceRefresh: true,
              excludeClients: nextExclude,
            });
            const refreshed = streamCache.get(key);
            if (refreshed) {
              entry = refreshed;
              upstreamRes = await fetch(entry.upstreamUrl, {
                method: req.method,
                headers: buildUpstreamHeaders(entry.upstreamHeaders),
                signal: abortController.signal,
              });
            }
          } catch (failoverErr) {
            console.error('[YTM Stream Proxy] Failover failed:', failoverErr);
          }
        }

        const forwardHeaders: Record<string, string> = {
          'Content-Type': upstreamRes.headers.get('content-type') || entry.stream.mimeType,
          'Accept-Ranges': upstreamRes.headers.get('accept-ranges') || 'bytes',
          'Cache-Control': 'no-store',
        };
        const contentLength = upstreamRes.headers.get('content-length');
        if (contentLength) {
          forwardHeaders['Content-Length'] = contentLength;
        }
        const contentRange = upstreamRes.headers.get('content-range');
        if (contentRange) {
          forwardHeaders['Content-Range'] = contentRange;
        }

        console.log(
          `[YTM Stream Proxy] ${req.method} ${key} (${entry.stream.clientUsed}) -> HTTP ${upstreamRes.status} (${forwardHeaders['Content-Type']})`,
        );
        res.writeHead(upstreamRes.status, forwardHeaders);

        if (req.method === 'HEAD' || !upstreamRes.body) {
          res.end();
          return;
        }

        const reader = upstreamRes.body.getReader();
        activeReader = reader;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            if (!res.write(Buffer.from(value))) {
              await new Promise<void>((r) => res.once('drain', r));
            }
          }
        }
        res.end();
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error('[YTM Stream Proxy] Upstream error:', err);
        }
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
        }
        if (!res.writableEnded) {
          res.end(err instanceof Error ? err.message : 'Upstream stream error');
        }
      }
    });

    server.on('error', (err) => {
      localStreamProxyPromise = null;
      reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        localStreamProxyPromise = null;
        reject(new Error('Failed to bind local stream proxy'));
        return;
      }
      server.unref();
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  return localStreamProxyPromise;
}

export function invalidateStreamCache(videoId?: string): void {
  if (!videoId) {
    streamCache.clear();
    return;
  }
  for (const key of streamCache.keys()) {
    if (key.startsWith(`${videoId}:`)) {
      streamCache.delete(key);
    }
  }
}

function generateCpn(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] & 63];
  }
  return out;
}

function parseUrlExpiryMs(url: string, fallbackSeconds = 18000): number {
  try {
    const parsed = new URL(url);
    const expireParam = parsed.searchParams.get('expire');
    if (expireParam) {
      const expSec = Number(expireParam);
      if (Number.isFinite(expSec) && expSec > 0) {
        return expSec * 1000;
      }
    }
  } catch {
    // ignore malformed URL
  }
  return Date.now() + fallbackSeconds * 1000;
}

function extractQualityRank(fmt: RawAdaptiveFormat, qualityPref = 'auto'): number {
  const bitrate = fmt.averageBitrate || fmt.bitrate || 0;
  const mime = (fmt.mimeType || '').toLowerCase();
  const isOpus = mime.includes('opus') || mime.includes('webm');
  const isMp4a = mime.includes('mp4a');
  const drcPenalty = fmt.isDrc ? -50000 : 0;
  const pref = qualityPref.toLowerCase();

  if (pref === 'low') {
    return -bitrate + (isOpus ? 5000 : 0) + drcPenalty;
  }
  if (pref === 'medium') {
    const distFrom80k = Math.abs(bitrate - 80000);
    return -distFrom80k + (isOpus ? 10000 : 0) + drcPenalty;
  }
  if (pref === 'high') {
    const distFrom145k = Math.abs(bitrate - 145000);
    return -distFrom145k + (isOpus ? 20000 : isMp4a ? 10000 : 0) + drcPenalty;
  }

  const codecBonus = isOpus ? 25000 : isMp4a ? 15000 : 0;
  return bitrate + codecBonus + drcPenalty;
}

function isNativeMobileClient(clientKey: string): boolean {
  return (
    clientKey === 'IOS' ||
    clientKey === 'ANDROID_VR_1_65_10' ||
    clientKey === 'ANDROID'
  );
}

async function decipherFormatUrl(
  fmt: RawAdaptiveFormat,
  clientKey: string,
  gl?: string,
  hl?: string,
): Promise<string | null> {
  if (fmt.url && !fmt.signatureCipher && !fmt.cipher) {
    if (isNativeMobileClient(clientKey)) {
      return fmt.url;
    }
    try {
      const yt = await getInnertubeClient({ gl, hl });
      if (yt.session.player) {
        const deciphered = await yt.session.player.decipher(fmt.url);
        if (deciphered && deciphered.startsWith('http')) {
          return deciphered;
        }
      }
    } catch {
      // Fallback to raw URL if player JS is unavailable
    }
    return fmt.url;
  }

  const cipherStr = fmt.signatureCipher || fmt.cipher;
  if (!cipherStr) return null;

  try {
    const yt = await getInnertubeClient({ gl, hl });
    if (!yt.session.player) return null;
    const deciphered = await yt.session.player.decipher(undefined, cipherStr);
    if (deciphered && deciphered.startsWith('http')) {
      return deciphered;
    }
  } catch (err) {
    console.warn('[YTM Stream] signatureCipher decipher failed:', err);
  }
  return null;
}

function hasValidAudioContainerHeader(bytes: Uint8Array, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (
    ct.includes('text/html') ||
    ct.includes('application/vnd.yt-ump') ||
    ct.includes('application/json')
  ) {
    return false;
  }
  if (bytes.byteLength < 8) return false;

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return true;
  }

  const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (
    boxType === 'ftyp' ||
    boxType === 'moov' ||
    boxType === 'moof' ||
    boxType === 'styp' ||
    boxType === 'sidx'
  ) {
    return true;
  }

  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return true;
  }

  if (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return true;
  }

  return false;
}

async function probeStreamUrl(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number }> {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get('ump') === '1' || parsed.searchParams.get('sabr') === '1') {
      return { ok: false, status: 415 };
    }

    const fullController = new AbortController();
    const timeoutId = globalThis.setTimeout(() => fullController.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers,
        signal: fullController.signal,
      });
    } finally {
      globalThis.clearTimeout(timeoutId);
    }

    if (res.status !== 200 && res.status !== 206) {
      void res.body?.cancel().catch(() => undefined);
      return { ok: false, status: res.status };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!res.body) {
      return { ok: false, status: 502 };
    }

    const reader = res.body.getReader();
    const { value } = await reader.read();
    void reader.cancel().catch(() => undefined);
    fullController.abort();

    if (!value || !hasValidAudioContainerHeader(value, contentType)) {
      return { ok: false, status: 415 };
    }

    return {
      ok: true,
      status: res.status,
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function resolveHlsAudioUrl(
  hlsManifestUrl: string,
  userAgent: string,
): Promise<{ url: string; bitrate: number } | null> {
  try {
    const res = await fetch(hlsManifestUrl, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const manifest = await res.text();
    const lines = manifest.split(/\r?\n/);

    for (const line of lines) {
      if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch?.[1]) {
          return { url: uriMatch[1], bitrate: 128000 };
        }
      }
    }

    let bestUrl: string | null = null;
    let bestBandwidth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        const bw = bwMatch ? Number(bwMatch[1]) : 128000;
        const nextLine = (lines[i + 1] || '').trim();
        if (nextLine.startsWith('http') && bw >= bestBandwidth) {
          bestBandwidth = bw;
          bestUrl = nextLine;
        }
      }
    }
    if (bestUrl) {
      return { url: bestUrl, bitrate: bestBandwidth || 128000 };
    }
  } catch {
    // ignore HLS fetch error
  }
  return null;
}

async function tryResolveWithClient(params: {
  videoId: string;
  clientKey: string;
  quality?: string;
  gl?: string;
  hl?: string;
  useAuth: boolean;
  disablePoToken?: boolean;
  visitorDataOverride?: string;
}): Promise<{
  stream?: ResolvedAudioStream;
  failureReason?: string;
  meta?: { title?: string; artist?: string; durationSec?: number };
}> {
  const profile = YOUTUBE_CLIENTS[params.clientKey];
  if (!profile) {
    return { failureReason: `${params.clientKey}: UNKNOWN_CLIENT` };
  }

  let signatureTimestamp: number | undefined;
  if (profile.useSignatureTimestamp) {
    try {
      const yt = await getInnertubeClient({ gl: params.gl, hl: params.hl });
      signatureTimestamp = yt.session.player?.signature_timestamp;
    } catch {
      // continue without sts
    }
  }

  const cpn = generateCpn();
  const contentPlaybackContext: Record<string, unknown> = {
    html5Preference: 'HTML5_PREF_WANTS',
    lactMilliseconds: '1500',
  };
  if (signatureTimestamp) {
    contentPlaybackContext.signatureTimestamp = signatureTimestamp;
  }

  const body: Record<string, unknown> = {
    videoId: params.videoId,
    cpn,
    contentCheckOk: true,
    racyCheckOk: true,
    playbackContext: {
      contentPlaybackContext,
    },
  };

  let data: PlayerApiResponse;
  try {
    data = await innerTubePost<PlayerApiResponse>({
      endpoint: 'player',
      clientKey: params.clientKey,
      body,
      gl: params.gl,
      hl: params.hl,
      useAuth: params.useAuth,
      disablePoToken: params.disablePoToken,
      visitorDataOverride: params.visitorDataOverride,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { failureReason: `${params.clientKey}: ${msg}` };
  }

  const meta = {
    title: data.videoDetails?.title,
    artist: data.videoDetails?.author,
    durationSec: Number(data.videoDetails?.lengthSeconds || 0) || undefined,
  };

  const status = data.playabilityStatus?.status || 'UNKNOWN';
  if (status !== 'OK') {
    const reason = data.playabilityStatus?.reason || status;
    return { failureReason: `${params.clientKey}: ${status} (${reason})`, meta };
  }

  const expiresInSec = Number(data.streamingData?.expiresInSeconds || 18000);
  const allFormats: RawAdaptiveFormat[] = [
    ...(data.streamingData?.adaptiveFormats || []),
    ...(data.streamingData?.formats || []),
  ];

  const audioFormats = allFormats.filter((f) =>
    (f.mimeType || '').toLowerCase().startsWith('audio/'),
  );

  const candidates =
    audioFormats.length > 0
      ? audioFormats
      : allFormats.filter((f) => Boolean(f.url || f.signatureCipher || f.cipher));

  const sorted = [...candidates].sort(
    (a, b) => extractQualityRank(b, params.quality) - extractQualityRank(a, params.quality),
  );

  const streamHeaders: Record<string, string> = {
    'User-Agent': profile.userAgent,
  };
  if (profile.platform === 'DESKTOP' && profile.apiOrigin) {
    streamHeaders.Origin = profile.apiOrigin;
    streamHeaders.Referer = `${profile.apiOrigin}/`;
  }

  let lastProbeStatus: number | null = null;

  for (const fmt of sorted) {
    const resolvedUrl = await decipherFormatUrl(
      fmt,
      params.clientKey,
      params.gl,
      params.hl,
    );
    if (!resolvedUrl) continue;

    const probe = await probeStreamUrl(resolvedUrl, streamHeaders);
    if (!probe.ok) {
      lastProbeStatus = probe.status;
      if (probe.status === 403 || probe.status === 415) {
        break;
      }
      continue;
    }

    const durationSec = fmt.approxDurationMs
      ? Math.round(Number(fmt.approxDurationMs) / 1000)
      : Number(data.videoDetails?.lengthSeconds || 0) || undefined;

    const expiresAt = parseUrlExpiryMs(resolvedUrl, expiresInSec);
    return {
      meta,
      stream: {
        url: resolvedUrl,
        streamUrl: resolvedUrl,
        audioUrl: resolvedUrl,
        mimeType: fmt.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: fmt.averageBitrate || fmt.bitrate || 128000,
        audioChannels: fmt.audioChannels || 2,
        sampleRate: fmt.audioSampleRate ? Number(fmt.audioSampleRate) : undefined,
        contentLength: fmt.contentLength ? Number(fmt.contentLength) : undefined,
        loudnessDb: fmt.loudnessDb,
        durationSec,
        clientUsed: params.clientKey,
        expiresAt,
        headers: streamHeaders,
      },
    };
  }

  if (data.streamingData?.hlsManifestUrl) {
    const hls = await resolveHlsAudioUrl(data.streamingData.hlsManifestUrl, profile.userAgent);
    if (hls) {
      const expiresAt = parseUrlExpiryMs(hls.url, expiresInSec);
      return {
        meta,
        stream: {
          url: hls.url,
          streamUrl: hls.url,
          audioUrl: hls.url,
          mimeType: 'application/x-mpegURL',
          bitrate: hls.bitrate,
          audioChannels: 2,
          durationSec: Number(data.videoDetails?.lengthSeconds || 0) || undefined,
          clientUsed: `${params.clientKey}:HLS`,
          expiresAt,
          headers: streamHeaders,
        },
      };
    }
  }

  return {
    meta,
    failureReason:
      lastProbeStatus !== null
        ? `${params.clientKey}: CDN_HTTP_${lastProbeStatus}`
        : candidates.length === 0
          ? `${params.clientKey}: NO_FORMAT`
          : `${params.clientKey}: DECIPHER_FAILED`,
  };
}

async function wrapWithLocalProxy(
  cacheKey: string,
  resolved: ResolvedAudioStream,
  payload: ResolveStreamPayload,
): Promise<ResolvedAudioStream> {
  const proxyBase = await ensureLocalStreamProxy();
  const proxiedUrl = `${proxyBase}/stream?key=${encodeURIComponent(cacheKey)}`;
  const wrapped: ResolvedAudioStream = {
    ...resolved,
    url: proxiedUrl,
    streamUrl: proxiedUrl,
    audioUrl: proxiedUrl,
  };
  streamCache.set(cacheKey, {
    stream: wrapped,
    upstreamUrl: resolved.url,
    upstreamHeaders: resolved.headers || {},
    payload,
  });
  return wrapped;
}

export async function resolveYtmAudioStream(
  payload: ResolveStreamPayload,
): Promise<ResolvedAudioStream> {
  const { videoId, quality = 'auto', gl, hl, forceRefresh, excludeClients = [] } = payload;
  if (!videoId) {
    throw new Error('resolveYtmAudioStream: videoId is required');
  }

  const active = await getActiveYtAccount();
  const isSignedIn = hasYouTubeLoginCookie(active?.cookie);
  const cacheKey = `${videoId}:${quality}:${isSignedIn ? active?.id || 'authed' : 'anon'}`;

  if (!forceRefresh) {
    const cached = streamCache.get(cacheKey);
    if (cached && cached.stream.expiresAt - Date.now() > 120_000) {
      return cached.stream;
    }
  }

  const excluded = new Set(excludeClients);
  const visitorData = !isSignedIn ? await ensureVisitorData(false) : undefined;
  const clientChain = (isSignedIn ? AUTHED_STREAM_CLIENT_KEYS : ANONYMOUS_STREAM_CLIENT_KEYS).filter(
    (c) => !excluded.has(c),
  );
  const failures: string[] = [];
  let discoveredMeta = {
    title: payload.title,
    artist: payload.artist,
    durationSec: payload.expectedDurationSec,
  };

  for (const clientKey of clientChain) {
    const profile = YOUTUBE_CLIENTS[clientKey];
    const useAuthForClient = Boolean(isSignedIn && profile?.supportsCookieAuthentication);

    const attempt = await tryResolveWithClient({
      videoId,
      clientKey,
      quality,
      gl,
      hl,
      useAuth: useAuthForClient,
      disablePoToken: !useAuthForClient,
      visitorDataOverride: useAuthForClient ? undefined : visitorData,
    });

    if (attempt.meta?.title && !discoveredMeta.title) {
      discoveredMeta = { ...discoveredMeta, ...attempt.meta };
    }

    if (attempt.stream) {
      const wrapped = await wrapWithLocalProxy(cacheKey, attempt.stream, payload);
      console.log(
        `[YTM Stream] Resolved ${videoId} (${quality}) via ${attempt.stream.clientUsed} @ ${Math.round(attempt.stream.bitrate / 1000)}kbps`,
      );
      return wrapped;
    }

    if (attempt.failureReason) {
      failures.push(attempt.failureReason);
    }
  }

  const freshVisitorData = await ensureVisitorData(true);
  const retryClients = ['IOS', 'ANDROID_VR_1_65_10', 'ANDROID', 'TVHTML5_SIMPLY'].filter(
    (c) => !excluded.has(c),
  );
  for (const clientKey of retryClients) {
    const attempt = await tryResolveWithClient({
      videoId,
      clientKey,
      quality,
      gl,
      hl,
      useAuth: false,
      disablePoToken: true,
      visitorDataOverride: freshVisitorData,
    });

    if (attempt.meta?.title && !discoveredMeta.title) {
      discoveredMeta = { ...discoveredMeta, ...attempt.meta };
    }

    if (attempt.stream) {
      const wrapped = await wrapWithLocalProxy(cacheKey, attempt.stream, payload);
      console.log(
        `[YTM Stream] Recovered ${videoId} (${quality}) via ${attempt.stream.clientUsed} @ ${Math.round(attempt.stream.bitrate / 1000)}kbps`,
      );
      return wrapped;
    }

    if (attempt.failureReason) {
      failures.push(`retry:${attempt.failureReason}`);
    }
  }

  // Fallback to .arch / plugin provider chain when YouTube InnerTube blocks all clients
  const pluginFallback = await resolveFallbackPluginStream({
    videoId,
    title: discoveredMeta.title,
    artist: discoveredMeta.artist,
    durationSec: discoveredMeta.durationSec,
  });

  if (pluginFallback) {
    const fallbackStream: ResolvedAudioStream = {
      url: pluginFallback.url,
      streamUrl: pluginFallback.url,
      audioUrl: pluginFallback.url,
      mimeType: pluginFallback.mimeType || 'audio/mpeg',
      bitrate: 320000,
      audioChannels: 2,
      durationSec: discoveredMeta.durationSec,
      clientUsed: `PLUGIN:${pluginFallback.pluginName}`,
      expiresAt: Date.now() + 3600 * 1000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      },
    };
    const wrapped = await wrapWithLocalProxy(cacheKey, fallbackStream, payload);
    console.log(
      `[YTM Stream] Fallback resolved ${videoId} via ${fallbackStream.clientUsed}`,
    );
    return wrapped;
  }

  throw new Error(
    `Unable to play track (${videoId}) across all clients: ${failures.join(' | ')}`,
  );
}