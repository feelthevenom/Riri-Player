import vm from 'node:vm';

export interface FallbackTrackMeta {
  videoId: string;
  title?: string;
  artist?: string;
  durationSec?: number;
}

export interface PluginSourceDefinition {
  id: string;
  name: string;
  code: string;
  enabled?: boolean;
}

interface CandidateTrack {
  id?: string;
  title?: string;
  artist?: string;
  durationSec?: number;
  streamUrl?: string;
}

/**
 * Default zero-key public catalog plugin (Audius) matching the searchTracks/getStreamUrl
 * contract from archPluginRunner_2.ts.
 */
export const DEFAULT_FALLBACK_PLUGINS: PluginSourceDefinition[] = [
  {
    id: 'audius-public',
    name: 'Audius Public Stream',
    enabled: true,
    code: `
      async function searchTracks(query) {
        const url =
          "https://discoveryprovider.audius.co/v1/tracks/search?app_name=RiriPlayer&query=" +
          encodeURIComponent(query);
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        const json = await res.json();
        return (json.data || []).slice(0, 5).map((t) => ({
          id: String(t.id),
          title: t.title || "",
          artist: t.user && t.user.name ? t.user.name : "",
          durationSec: Number(t.duration) || 0,
          streamUrl:
            "https://discoveryprovider.audius.co/v1/tracks/" +
            encodeURIComponent(String(t.id)) +
            "/stream?app_name=RiriPlayer"
        }));
      }

      async function getStreamUrl(trackId) {
        return (
          "https://discoveryprovider.audius.co/v1/tracks/" +
          encodeURIComponent(String(trackId)) +
          "/stream?app_name=RiriPlayer"
        );
      }
    `,
  },
];

function evaluatePluginFunctions(code: string): {
  searchTracks?: (query: string) => Promise<CandidateTrack[]> | CandidateTrack[];
  getStreamUrl?: (trackId: string) => Promise<string | null | undefined> | string | null | undefined;
} {
  const sandbox: Record<string, unknown> = {
    fetch: globalThis.fetch.bind(globalThis),
    URL,
    URLSearchParams,
    AbortSignal,
    encodeURIComponent,
    decodeURIComponent,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    Promise,
    console,
    module: { exports: {} as Record<string, unknown> },
    exports: {} as Record<string, unknown>,
  };
  sandbox.exports = (sandbox.module as { exports: Record<string, unknown> }).exports;

  const wrapped = `
    (async () => {
      ${code}
      return {
        __searchTracks: typeof searchTracks === "function" ? searchTracks : null,
        __getStreamUrl: typeof getStreamUrl === "function"
          ? getStreamUrl
          : (typeof getTrackStreamUrl === "function" ? getTrackStreamUrl : null)
      };
    })()
  `;

  const context = vm.createContext(sandbox);
  const script = new vm.Script(wrapped);
  const exported = (sandbox.module as { exports: Record<string, unknown> }).exports;

  return {
    searchTracks: async (query: string) => {
      const promiseOrVal = script.runInContext(context, { timeout: 3000 }) as Promise<{
        __searchTracks?: ((q: string) => Promise<CandidateTrack[]> | CandidateTrack[]) | null;
      }>;
      const mod = await promiseOrVal;
      const fn =
        mod?.__searchTracks ||
        (typeof exported.searchTracks === 'function'
          ? (exported.searchTracks as (q: string) => Promise<CandidateTrack[]> | CandidateTrack[])
          : undefined);
      if (!fn) return [];
      const out = await fn(query);
      return Array.isArray(out) ? out : [];
    },
    getStreamUrl: async (trackId: string) => {
      const promiseOrVal = script.runInContext(context, { timeout: 3000 }) as Promise<{
        __getStreamUrl?:
          | ((id: string) => Promise<string | null | undefined> | string | null | undefined)
          | null;
      }>;
      const mod = await promiseOrVal;
      const fn =
        mod?.__getStreamUrl ||
        (typeof exported.getStreamUrl === 'function'
          ? (exported.getStreamUrl as (
              id: string,
            ) => Promise<string | null | undefined> | string | null | undefined)
          : undefined);
      if (!fn) return '';
      const url = await fn(trackId);
      return typeof url === 'string' ? url : '';
    },
  };
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|\|.*/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(candidate: CandidateTrack, meta: FallbackTrackMeta): number {
  const targetTitle = normalizeTitle(meta.title || '');
  const candTitle = normalizeTitle(candidate.title || '');
  if (!targetTitle || !candTitle) return 0;

  let score = 0;
  if (candTitle === targetTitle) {
    score += 60;
  } else if (candTitle.includes(targetTitle) || targetTitle.includes(candTitle)) {
    score += 35;
  } else {
    const targetWords = targetTitle.split(' ').filter((w) => w.length > 2);
    const hits = targetWords.filter((w) => candTitle.includes(w)).length;
    score += hits * 12;
  }

  if (meta.artist && candidate.artist) {
    const targetArtist = normalizeTitle(meta.artist);
    const candArtist = normalizeTitle(candidate.artist);
    if (candArtist && targetArtist && (candArtist.includes(targetArtist) || targetArtist.includes(candArtist))) {
      score += 30;
    }
  }

  if (meta.durationSec && candidate.durationSec) {
    const diff = Math.abs(meta.durationSec - candidate.durationSec);
    if (diff <= 5) score += 15;
    else if (diff <= 15) score += 5;
  }

  return score;
}

export async function resolveFallbackPluginStream(
  meta: FallbackTrackMeta,
  plugins: PluginSourceDefinition[] = DEFAULT_FALLBACK_PLUGINS,
): Promise<{ url: string; pluginName: string; mimeType?: string } | null> {
  const query = [meta.title, meta.artist].filter(Boolean).join(' ').trim();
  if (!query) return null;

  const activePlugins = plugins.filter((p) => p.enabled !== false && p.code?.trim());

  for (const plugin of activePlugins) {
    try {
      const fns = evaluatePluginFunctions(plugin.code);
      if (!fns.searchTracks) continue;

      const results = await fns.searchTracks(query);
      if (!results.length) continue;

      const ranked = [...results]
        .map((item) => ({ item, score: scoreMatch(item, meta) }))
        .sort((a, b) => b.score - a.score);

      const best = ranked[0]?.item;
      if (!best) continue;

      let streamUrl = best.streamUrl || '';
      if (!streamUrl && best.id && fns.getStreamUrl) {
        streamUrl = (await fns.getStreamUrl(best.id)) || '';
      }

      if (streamUrl && /^https?:\/\//i.test(streamUrl)) {
        return {
          url: streamUrl,
          pluginName: plugin.name,
          mimeType: 'audio/mpeg',
        };
      }
    } catch (err) {
      console.warn(`[YTM Plugin Fallback] ${plugin.name} failed:`, err);
    }
  }

  return null;
}