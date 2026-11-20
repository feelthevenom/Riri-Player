import React, { useRef, useState } from 'react';
import { Code2, Loader2, Play, Plug, Plus, Trash2, Upload } from 'lucide-react';
import { useRiriPlayer } from '../context/RiriPlayerContext';
import { SAMPLE_ARCH_PLUGIN_TEMPLATE, runArchPluginSearch } from '../utils/archPluginRunner';
import { Track } from '../types/music';
import { SortableTrackTable } from '../components/SortableTrackTable';

export const PluginsScreen: React.FC = () => {
  const { plugins, addPlugin, togglePlugin, removePlugin, showToast } = useRiriPlayer();

  const [name, setName] = useState('Audius Custom Provider');
  const [author, setAuthor] = useState('Community');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState(
    'Custom .arch provider querying discoveryprovider.audius.co inside a sandboxed Web Worker.',
  );
  const [code, setCode] = useState(SAMPLE_ARCH_PLUGIN_TEMPLATE);
  const [testQuery, setTestQuery] = useState('electronic');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Track[]>([]);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleInstall = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    addPlugin({
      name: name.trim(),
      author: author.trim() || 'Unknown',
      version: version.trim() || '1.0.0',
      description: description.trim() || 'Custom .arch JS provider',
      code,
      enabled: true,
    });
  };

  const handleUploadFile = async (file: File) => {
    const text = await file.text();
    const baseName = file.name.replace(/\.(arch|js)$/i, '');
    setName(baseName || 'Uploaded Plugin');
    setCode(text);
    showToast(`Loaded "${file.name}" into editor`);
  };

  const handleTestPlugin = async (pluginId: string) => {
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) return;
    setTestingId(pluginId);
    try {
      const tracks = await runArchPluginSearch(plugin, testQuery || 'music');
      setTestResults(tracks);
      showToast(`Plugin "${plugin.name}" returned ${tracks.length} track(s)`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Plugin execution failed', 'error');
      setTestResults([]);
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Plug className="w-6 h-6 text-[var(--md-primary)]" />
            <span>.arch Provider Extensions</span>
          </h1>
          <p className="text-xs text-[var(--md-on-surface-variant)]">
            Install sandboxed Web Worker JavaScript plugins defining{' '}
            <span className="font-mono">searchTracks(query)</span> and{' '}
            <span className="font-mono">getStreamUrl(trackId)</span>
          </p>
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".arch,.js,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUploadFile(f);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container-highest)] cursor-pointer"
          >
            <Upload className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Upload .arch / .js File</span>
          </button>
        </div>
      </div>

      {/* Installed Plugins */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold">Installed Plugins ({plugins.length})</h2>
          {plugins.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="plugin-test-query" className="text-xs text-[var(--md-on-surface-variant)]">
                Test Query:
              </label>
              <input
                id="plugin-test-query"
                type="text"
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                className="h-8 w-44 rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-2.5 text-xs"
              />
            </div>
          )}
        </div>

        {plugins.length === 0 ? (
          <div className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-6 text-xs text-[var(--md-on-surface-variant)]">
            No `.arch` plugins installed yet. Use the installer below to add the sample Audius
            provider or paste your own custom JavaScript provider.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {plugins.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container)] p-4 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-sm truncate">
                      {p.name}{' '}
                      <span className="text-[11px] font-normal text-[var(--md-on-surface-variant)]">
                        v{p.version}
                      </span>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={() => togglePlugin(p.id)}
                        className="accent-[var(--md-primary)]"
                      />
                      <span>{p.enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                  </div>
                  <div className="text-[11px] text-[var(--md-on-surface-variant)] mt-0.5">
                    by {p.author}
                  </div>
                  <p className="text-xs text-[var(--md-on-surface-variant)] mt-2">
                    {p.description}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--md-outline-variant)]/30">
                  <button
                    type="button"
                    disabled={testingId === p.id}
                    onClick={() => void handleTestPlugin(p.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] text-xs font-semibold cursor-pointer"
                  >
                    {testingId === p.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>Test Search</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removePlugin(p.id)}
                    aria-label={`Remove ${p.name}`}
                    className="p-1.5 rounded-lg text-[var(--md-on-surface-variant)] hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {testResults.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-bold">Plugin Test Output</h2>
          <SortableTrackTable tracks={testResults} />
        </section>
      )}

      {/* Install New Plugin Editor */}
      <section className="rounded-2xl border border-[var(--md-outline-variant)]/40 bg-[var(--md-surface-container-low)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Code2 className="w-4 h-4 text-[var(--md-primary)]" />
            <span>Create / Install .arch Plugin</span>
          </h2>
          <button
            type="button"
            onClick={() => setCode(SAMPLE_ARCH_PLUGIN_TEMPLATE)}
            className="text-xs font-semibold text-[var(--md-primary)] hover:underline cursor-pointer"
          >
            Load Sample Template
          </button>
        </div>

        <form onSubmit={handleInstall} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="plugin-name" className="block text-xs font-semibold mb-1">
                Plugin Name
              </label>
              <input
                id="plugin-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-9 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
              />
            </div>
            <div>
              <label htmlFor="plugin-author" className="block text-xs font-semibold mb-1">
                Author
              </label>
              <input
                id="plugin-author"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full h-9 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
              />
            </div>
            <div>
              <label htmlFor="plugin-version" className="block text-xs font-semibold mb-1">
                Version
              </label>
              <input
                id="plugin-version"
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="w-full h-9 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] px-3 text-xs"
              />
            </div>
          </div>

          <div>
            <label htmlFor="plugin-code" className="block text-xs font-semibold mb-1">
              Provider Script (JavaScript)
            </label>
            <textarea
              id="plugin-code"
              rows={9}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container)] p-3 font-mono text-xs focus:outline-none focus:border-[var(--md-primary)]"
            />
          </div>

          <button
            type="submit"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-bold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Install .arch Plugin</span>
          </button>
        </form>
      </section>
    </div>
  );
};
