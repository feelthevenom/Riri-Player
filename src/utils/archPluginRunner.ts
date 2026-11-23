import { ArchPlugin, Track } from '../types/music';
import { FALLBACK_ARTWORK_DATA_URL } from '../data/catalog';

interface PluginWorkerMessage {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function createWorkerSource(pluginCode: string): string {
  return `
    const module = { exports: {} };
    const exports = module.exports;
    let __initError = null;
    try {
      const __compiled = new Function(
        'module',
        'exports',
        ${JSON.stringify(pluginCode)} + '\\n;return { searchTracks: typeof searchTracks === "function" ? searchTracks : null, getStreamUrl: typeof getStreamUrl === "function" ? getStreamUrl : (typeof getTrackStreamUrl === "function" ? getTrackStreamUrl : null) };'
      );
      var __topLevelFns = __compiled(module, exports) || {};
    } catch (err) {
      __initError = err && err.message ? err.message : String(err);
      var __topLevelFns = {};
    }

    const api = module.exports && (module.exports.default || module.exports);

    self.onmessage = async (event) => {
      const { id, action, payload } = event.data || {};
      if (__initError) {
        self.postMessage({ id, ok: false, error: 'Plugin syntax/init error: ' + __initError });
        return;
      }
      try {
        if (action === 'searchTracks') {
          const fn = __topLevelFns.searchTracks || (api && api.searchTracks);
          if (typeof fn !== 'function') {
            throw new Error('Plugin does not export searchTracks(query)');
          }
          const res = await fn(payload.query);
          self.postMessage({ id, ok: true, result: Array.isArray(res) ? res : [] });
        } else if (action === 'getStreamUrl') {
          const fn = __topLevelFns.getStreamUrl || (api && (api.getStreamUrl || api.getTrackStreamUrl));
          if (typeof fn !== 'function') {
            throw new Error('Plugin does not export getStreamUrl(trackId)');
          }
          const res = await fn(payload.trackId);
          self.postMessage({ id, ok: true, result: res });
        } else {
          throw new Error('Unknown plugin action: ' + action);
        }
      } catch (err) {
        self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
      }
    };
  `;
}

function callWorker(
  pluginCode: string,
  action: 'searchTracks' | 'getStreamUrl',
  payload: Record<string, unknown>,
  timeoutMs = 7000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const src = createWorkerSource(pluginCode);
    const blob = new Blob([src], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const cleanup = () => {
      window.clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Plugin execution timed out'));
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent<PluginWorkerMessage>) => {
      const msg = e.data;
      if (!msg || (msg.id !== callId && msg.id !== '__init__')) return;
      cleanup();
      if (msg.ok) {
        resolve(msg.result);
      } else {
        reject(new Error(msg.error || 'Plugin execution error'));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(new Error(err.message || 'Worker runtime error'));
    };

    worker.postMessage({ id: callId, action, payload });
  });
}

export async function runArchPluginSearch(plugin: ArchPlugin, query: string): Promise<Track[]> {
  const raw = (await callWorker(plugin.code, 'searchTracks', { query })) as Array<
    Partial<Track> & { id?: string; title?: string; artist?: string; streamUrl?: string }
  >;

  return (raw || []).map((item, idx) => ({
    id: item.id ? `${plugin.id}:${item.id}` : `${plugin.id}:${idx}:${Date.now()}`,
    title: String(item.title || 'Untitled Track'),
    artist: String(item.artist || plugin.name),
    album: String(item.album || plugin.name),
    durationSec: Number(item.durationSec) || 180,
    thumbnailUrl: item.thumbnailUrl || FALLBACK_ARTWORK_DATA_URL,
    streamUrl: item.streamUrl || '',
    genre: item.genre || 'Plugin',
    qualityLabel: item.qualityLabel || 'PLUGIN',
    source: 'plugin',
    pluginId: plugin.id,
  }));
}

export async function resolveArchPluginStream(plugin: ArchPlugin, trackId: string): Promise<string> {
  const rawId = trackId.startsWith(`${plugin.id}:`)
    ? trackId.slice(plugin.id.length + 1)
    : trackId;
  const result = await callWorker(plugin.code, 'getStreamUrl', { trackId: rawId });
  return typeof result === 'string' ? result : '';
}

export const SAMPLE_ARCH_PLUGIN_TEMPLATE = `// Riri Player .arch Provider Plugin
// Runs inside a sandboxed Web Worker.
// Define searchTracks(query) and getStreamUrl(trackId).

async function searchTracks(query) {
  const q = encodeURIComponent("mediatype:(audio) AND (" + query + ")");
  const res = await fetch(
    "https://archive.org/advancedsearch.php?q=" + q + "&fl[]=identifier,title,creator&rows=10&output=json"
  );
  if (!res.ok) return [];
  const json = await res.json();
  const docs = (json.response && json.response.docs) || [];
  return docs.map((d) => ({
    id: String(d.identifier),
    title: d.title || d.identifier,
    artist: Array.isArray(d.creator) ? d.creator[0] : (d.creator || "Internet Archive"),
    album: "Internet Archive",
    durationSec: 180,
    thumbnailUrl: "https://archive.org/services/img/" + encodeURIComponent(d.identifier),
    streamUrl: "",
    qualityLabel: "PLUGIN"
  }));
}

async function getStreamUrl(trackId) {
  const res = await fetch("https://archive.org/metadata/" + encodeURIComponent(trackId) + "/files");
  if (!res.ok) return "";
  const json = await res.json();
  const files = json.result || [];
  const audio = files.find((f) => /\\.(mp3|ogg|flac|m4a)$/i.test(f.name || ""));
  return audio ? "https://archive.org/download/" + encodeURIComponent(trackId) + "/" + encodeURIComponent(audio.name) : "";
}
`;
